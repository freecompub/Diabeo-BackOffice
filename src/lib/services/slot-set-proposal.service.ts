/**
 * US-2657 (slice C3a) — Service des **propositions d'ENSEMBLE de créneaux**.
 *
 * Représente une édition de groupe (valeurs et/ou restructuration) soumise par un patient EXPERT mais
 * NON auto-applicable (hors enveloppe ou structurelle) : stockée en bloc pour revue MÉDECIN.
 *
 * ⚠️ US-2657 — **on ne propose plus par-valeur** : toute édition patient EXPERT non auto-appliquée est
 * proposée GROUPÉE (disposition entière du jeu de créneaux), quel que soit le nombre de valeurs modifiées.
 * Ce service REMPLACE la voie par-valeur `AdjustmentProposal` pour ce cas ; le fallback unitaire du harnais
 * C2 `applyExpertEditGoverned` est destiné à être routé via l'orchestrateur GROUPÉ C3b `applyExpertGroupGoverned`.
 * À la création, les propositions `pending` du même `(patient × paramètre)` — d'ensemble ET par-valeur —
 * sont supersédées (cohérent avec « plus de par-valeur »).
 *
 * Invariant : **une seule proposition d'ensemble PENDING par (patient × paramètre)** — garanti EN BASE par
 * l'index unique partiel `slot_set_proposals_one_pending_per_param` (WHERE status = 'pending') ; la course
 * TOCTOU de double-soumission remonte en `P2002` → `duplicatePendingProposal`.
 *
 * **Acceptation atomique** : lecture + flip `pending → accepted` (compare-and-swap) + `replaceSlotSet` +
 * audit dans **une seule transaction**. Un rejet/supersede concurrent (flip `count 0`) ou un échec clinique
 * de `replaceSlotSet` (bornes) rollback le tout → jamais de config appliquée sans acceptation valide, ni
 * l'inverse. Bornes/couverture validées DÈS la création (`assertValidSlotSet`, symétrie création ⇄ accept).
 *
 * L'authz (rôle/portefeuille) est portée par les routes (C3c patient / C3d médecin) ; ce service est scopé
 * patient (anti-IDOR) et filtre les patients soft-deleted (RGPD).
 */
import { z } from "zod"
import type { ProposalStatus } from "@prisma/client"
import { prisma } from "@/lib/db/client"
import { isUniqueViolationOn } from "@/lib/db/prisma-errors"
import { insulinTherapyService, assertValidSlotSet } from "@/lib/services/insulin-therapy.service"
import { treatmentModeService } from "@/lib/services/treatment-mode.service"
import { auditService, type AuditContext } from "@/lib/services/audit.service"

/** Créneau proposé (forme du JSON `proposedSlots`). */
export type ProposedSlot = { startHour: number; endHour: number; value: number; mealLabel?: string }

/** Paramètres à jeu de créneaux gérés (ISF/ICR). */
export type SlotSetParam = "insulinSensitivityFactor" | "insulinToCarbRatio"

/** Mapping paramètre à jeu de créneaux → clé courte `replaceSlotSet`/verrou. Source unique (réutilisé C3b). */
export const REPLACE_KEY: Record<SlotSetParam, "isf" | "icr"> = {
  insulinSensitivityFactor: "isf",
  insulinToCarbRatio: "icr",
}

/**
 * Garde de FORME du JSON `proposedSlots` (encodage : `endHour ∈ [0,23]`, passage minuit via
 * `startHour > endHour`). Les bornes CLINIQUES (ISF/ICR) et la couverture (no-gap/no-overlap) sont
 * vérifiées séparément par `assertValidSlotSet`. Ici on garantit uniquement des entiers/valeurs finies —
 * évite un `NaN` dans les calculs de couverture en cas de JSON corrompu.
 */
const proposedSlotsSchema = z.array(
  z.object({
    startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(0).max(23),
    value: z.number().finite().positive(),
    mealLabel: z.string().max(120).optional(),
  }),
) // le jeu vide passe la FORME → `emptySlotSet` levé par `assertValidSlotSet` (contrat d'erreur stable)

/** Parse + valide la forme du jeu ; `invalidSlotSet` si malformé (à la création comme à la relecture). */
function parseSlots(raw: unknown): ProposedSlot[] {
  const parsed = proposedSlotsSchema.safeParse(raw)
  if (!parsed.success) throw new Error("invalidSlotSet")
  return parsed.data
}

export const slotSetProposalService = {
  /**
   * Crée une proposition d'ensemble PENDING. Valide la forme (`invalidSlotSet`) et la validité
   * clinique/couverture DÈS la création (`assertValidSlotSet`), refuse un patient non insuliné
   * (`nonInsulinNoDose`, frontière MDR) ou soft-deleted (`patientNotFound`). Supersède les propositions
   * pending du même `(patient × paramètre)` (d'ensemble ET par-valeur).
   * @throws invalidSlotSet | emptySlotSet | zeroDurationSlot | valueOutOfBounds | slotOverlap | slotGap
   * @throws patientNotFound | nonInsulinNoDose | duplicatePendingProposal
   */
  async createSetProposal(
    patientId: number,
    parameterType: SlotSetParam,
    proposedSlots: ProposedSlot[],
    proposedByUserId: number,
    ctx?: AuditContext,
  ) {
    // 1. Forme (Zod) puis validité clinique/couverture — fail-fast, AVANT tout accès DB (symétrie
    //    création ⇄ acceptation : une proposition inacceptable ne doit pas pouvoir être créée).
    const slots = parseSlots(proposedSlots)
    assertValidSlotSet(REPLACE_KEY[parameterType], slots)

    // 2. Patient existant et NON soft-deleted (RGPD).
    const patient = await prisma.patient.findFirst({
      where: { id: patientId, deletedAt: null },
      select: { id: true },
    })
    if (!patient) throw new Error("patientNotFound")

    // 3. Frontière DISPOSITIF MÉDICAL (US-2651, §12.5) : jamais de proposition de dose pour un patient
    //    NON INSULINÉ. Mode dérivé SERVEUR (fail-closed). Aligné sur adjustmentService.createProposal.
    const { mode } = await treatmentModeService.resolveTreatmentMode(patientId)
    if (mode === "nonInsulin") throw new Error("nonInsulinNoDose")

    try {
      return await prisma.$transaction(async (tx) => {
        // Une seule PENDING par (patient × paramètre) : la précédente d'ENSEMBLE est superseded.
        await tx.slotSetProposal.updateMany({
          where: { patientId, parameterType, status: "pending" },
          data: { status: "superseded" },
        })
        // « Plus de par-valeur » : une soumission groupée supersède aussi les AdjustmentProposal pending
        // du même paramètre (évite des propositions concurrentes/contradictoires côté médecin).
        // `reviewedBy: null` — la supersession est programmatique, PAS une revue médecin (le patient
        // soumissionnaire n'est pas un reviewer ; éviter un `reviewedBy` trompeur en forensic).
        await tx.adjustmentProposal.updateMany({
          where: { patientId, parameterType, status: "pending" },
          data: { status: "superseded", reviewedAt: new Date(), reviewedBy: null },
        })
        const proposal = await tx.slotSetProposal.create({
          data: { patientId, parameterType, proposedSlots: slots, proposedByUserId, status: "pending" },
          select: { id: true },
        })
        await auditService.logWithTx(tx, {
          userId: proposedByUserId,
          action: "CREATE",
          resource: "SLOT_SET_PROPOSAL",
          resourceId: proposal.id,
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          requestId: ctx?.requestId,
          metadata: { patientId, kind: "slotSetProposalCreated", parameterType, slots: slots.length },
        })
        return { id: proposal.id }
      })
    } catch (e) {
      // Course TOCTOU (deux soumissions simultanées) rattrapée par l'index partiel unique
      // `slot_set_proposals_one_pending_per_param`. `isUniqueViolationOn` lit la forme d'erreur Prisma 7 +
      // adapter-pg (`meta.driverAdapterError.cause`, `meta.target` étant `undefined`) — cf. prisma-errors.
      if (isUniqueViolationOn(e, "one_pending")) throw new Error("duplicatePendingProposal")
      throw e
    }
  },

  /**
   * **Accepte** une proposition d'ensemble (acte MÉDECIN — gate à la route). ATOMIQUE : lecture + flip
   * gardé (compare-and-swap `pending → accepted`) + application en bloc (`replaceSlotSet`) + audit dans une
   * SEULE transaction. Un rejet/supersede concurrent (flip `count 0`) ou un échec clinique de
   * `replaceSlotSet` (bornes) rollback tout → aucune config appliquée sans acceptation valide, ni l'inverse.
   * Scopé patient (anti-IDOR), patient soft-deleted exclu.
   * @throws slotSetProposalNotFound (absente/non pending/hors périmètre/soft-deleted/rejetée-supersédée en course)
   * @throws unsupportedSlotSetParam | invalidSlotSet | settingsNotFound | valueOutOfBounds | slotOverlap | slotGap | zeroDurationSlot | emptySlotSet
   */
  async acceptSetProposal(id: string, patientId: number, reviewerUserId: number, ctx?: AuditContext) {
    return prisma.$transaction(async (tx) => {
      const proposal = await tx.slotSetProposal.findFirst({
        where: { id, patientId, status: "pending", patient: { deletedAt: null } },
        select: { parameterType: true, proposedSlots: true },
      })
      if (!proposal) throw new Error("slotSetProposalNotFound")

      // Garde runtime : le type DB `AdjustableParameter` est plus large (basalRate/fixedDose n'ont pas de
      // jeu de créneaux ISF/ICR). Le cast serait unsafe sans cette vérification (REPLACE_KEY undefined).
      const param = proposal.parameterType
      if (param !== "insulinSensitivityFactor" && param !== "insulinToCarbRatio") {
        throw new Error("unsupportedSlotSetParam")
      }
      const slots = parseSlots(proposal.proposedSlots)

      // Compare-and-swap DANS la tx : verrouille l'acte pending → accepted. `count 0` = la proposition a
      // été rejetée/supersédée (ou acceptée) en course → throw → rollback (aucune config appliquée).
      const flipped = await tx.slotSetProposal.updateMany({
        where: { id, patientId, status: "pending" },
        data: { status: "accepted", reviewedByUserId: reviewerUserId, reviewedAt: new Date() },
      })
      if (flipped.count === 0) throw new Error("slotSetProposalNotFound")

      // Apply en bloc DANS la même transaction (atomicité). Un échec (bornes/couverture) propage l'exception
      // → rollback du flip → la proposition reste `pending` (fail-closed). `replaceSlotSet` supersède au
      // passage les autres propositions pending du paramètre.
      await insulinTherapyService.replaceSlotSet(REPLACE_KEY[param], patientId, slots, reviewerUserId, ctx, tx)

      await auditService.logWithTx(tx, {
        userId: reviewerUserId,
        action: "PROPOSAL_ACCEPTED",
        resource: "SLOT_SET_PROPOSAL",
        resourceId: id,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        requestId: ctx?.requestId,
        metadata: { patientId, kind: "slotSetProposalAccepted", parameterType: param },
      })
      return { id, status: "accepted" as const }
    })
  },

  /**
   * **Rejette** une proposition d'ensemble (acte MÉDECIN — gate à la route). Flip `pending → rejected` +
   * audit dans une seule transaction. Scopé patient, patient soft-deleted exclu.
   * @throws slotSetProposalNotFound si absente/non pending/hors périmètre/soft-deleted.
   */
  async rejectSetProposal(id: string, patientId: number, reviewerUserId: number, ctx?: AuditContext) {
    return prisma.$transaction(async (tx) => {
      const res = await tx.slotSetProposal.updateMany({
        where: { id, patientId, status: "pending", patient: { deletedAt: null } },
        data: { status: "rejected", reviewedByUserId: reviewerUserId, reviewedAt: new Date() },
      })
      if (res.count === 0) throw new Error("slotSetProposalNotFound")
      await auditService.logWithTx(tx, {
        userId: reviewerUserId,
        action: "PROPOSAL_REJECTED",
        resource: "SLOT_SET_PROPOSAL",
        resourceId: id,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        requestId: ctx?.requestId,
        metadata: { patientId, kind: "slotSetProposalRejected" },
      })
      return { id, status: "rejected" as const }
    })
  },

  /**
   * Liste les propositions d'ensemble d'un patient (option : filtrer par statut). Audite le READ (les
   * `proposedSlots` sont des données de config insuline — donnée de santé). Patient soft-deleted exclu.
   * @param auditUserId - PS effectuant la lecture (piste d'audit HDS).
   */
  async listSetProposals(patientId: number, auditUserId: number, status?: ProposalStatus, ctx?: AuditContext) {
    const proposals = await prisma.slotSetProposal.findMany({
      where: { patientId, patient: { deletedAt: null }, ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
    })
    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "SLOT_SET_PROPOSAL",
      resourceId: String(patientId),
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      requestId: ctx?.requestId,
      metadata: { patientId, kind: "slotSetProposalList", count: proposals.length },
    })
    return proposals
  },
}
