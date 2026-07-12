/**
 * US-2657 (slice C3a) — Service des **propositions d'ENSEMBLE de créneaux**.
 *
 * Représente une édition de groupe (valeurs et/ou restructuration) soumise par un patient : stockée en bloc
 * pour revue MÉDECIN. Il n'y a **pas d'auto-application** — une soumission patient est TOUJOURS une
 * proposition (route `PUT /api/patient/insulin-slot-set`).
 *
 * ⚠️ US-2657 — **on ne propose plus par-valeur** : toute édition patient est proposée GROUPÉE (disposition
 * entière du jeu de créneaux), quel que soit le nombre de valeurs modifiées. Ce service REMPLACE la voie
 * par-valeur `AdjustmentProposal` pour ce cas. À la création, les propositions `pending` du même
 * `(patient × paramètre)` — d'ensemble ET par-valeur — sont supersédées (cohérent avec « plus de par-valeur »).
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
import type { ProposalStatus, ProposalSource } from "@prisma/client"
import { prisma } from "@/lib/db/client"
import { isUniqueViolationOn } from "@/lib/db/prisma-errors"
import { isfIcrSlotSchema, type IsfIcrSlot } from "@/lib/insulin/grouped-proposal"
import { insulinTherapyService, assertValidSlotSet } from "@/lib/services/insulin-therapy.service"
import { treatmentModeService } from "@/lib/services/treatment-mode.service"
import { auditService, type AuditContext } from "@/lib/services/audit.service"

/**
 * Créneau proposé (forme du JSON `proposedSlots`). US-2663 — alias de `IsfIcrSlot`, la **source de vérité
 * de forme unique** (`src/lib/insulin/grouped-proposal.ts`) : plus de définition parallèle à maintenir.
 */
export type ProposedSlot = IsfIcrSlot

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
// US-2663 — forme des créneaux ISF/ICR importée du module de typage unique (`isfIcrSlotSchema`) plutôt que
// redéfinie ici. Le jeu vide passe la FORME → `emptySlotSet` levé par `assertValidSlotSet` (contrat stable).
const proposedSlotsSchema = z.array(isfIcrSlotSchema)

/** Parse + valide la forme du jeu ; `invalidSlotSet` si malformé (à la création comme à la relecture). */
function parseSlots(raw: unknown): ProposedSlot[] {
  const parsed = proposedSlotsSchema.safeParse(raw)
  if (!parsed.success) throw new Error("invalidSlotSet")
  return parsed.data
}

/**
 * US-2663 (S0) — Snapshot de la base PAR créneau **à la génération** de la proposition. Photographie la
 * disposition ISF/ICR ACTIVE du patient (mêmes champs que `ProposedSlot` : `value` = `sensitivityFactorGl`
 * (g/L·U) pour l'ISF, `gramsPerUnit` (g/U) `+ mealLabel` pour l'ICR). Persisté dans `baselineSlots` : à
 * l'acceptation (S1), un compare-and-swap PAR CRÉNEAU comparera la base LIVE à ce snapshot pour détecter une
 * dérive (`baselineMoved`) — garde-fou MDR anti-écrasement d'un ajustement médecin concurrent.
 *
 * Aucune config (patient non encore paramétré) → `[]` (jeu vide) : une base vide est un état valide (le
 * médecin part de zéro), distinct de `null` (proposition legacy pré-S0 sans snapshot).
 */
async function captureBaselineSlots(patientId: number, parameterType: SlotSetParam): Promise<ProposedSlot[]> {
  // Scope via la relation `settings` : `InsulinTherapySettings.patientId @unique` ⇒ 1 config/patient, donc
  // `where: { settings: { patientId } }` lit EXACTEMENT les créneaux que `replaceSlotSet` réécrirait (symétrie
  // baseline ⇄ apply). Si cet invariant 1-settings/patient venait à changer, S1 devra résoudre le `settingsId`
  // unique et scoper dessus (comme le chemin d'application) pour éviter d'entrelacer des configs distinctes.
  if (parameterType === "insulinSensitivityFactor") {
    const rows = await prisma.insulinSensitivityFactor.findMany({
      where: { settings: { patientId } },
      orderBy: { startHour: "asc" },
      select: { startHour: true, endHour: true, sensitivityFactorGl: true },
    })
    return rows.map((s) => ({ startHour: s.startHour, endHour: s.endHour, value: Number(s.sensitivityFactorGl) }))
  }
  const rows = await prisma.carbRatio.findMany({
    where: { settings: { patientId } },
    orderBy: { startHour: "asc" },
    select: { startHour: true, endHour: true, gramsPerUnit: true, mealLabel: true },
  })
  return rows.map((s) => ({
    startHour: s.startHour,
    endHour: s.endHour,
    value: Number(s.gramsPerUnit),
    ...(s.mealLabel != null ? { mealLabel: s.mealLabel } : {}),
  }))
}

export const slotSetProposalService = {
  /**
   * Crée une proposition d'ensemble PENDING. Valide la forme (`invalidSlotSet`) et la validité
   * clinique/couverture DÈS la création (`assertValidSlotSet`), refuse un patient non insuliné
   * (`nonInsulinNoDose`, frontière MDR) ou soft-deleted (`patientNotFound`). Supersède les propositions
   * pending du même `(patient × paramètre)` (d'ensemble ET par-valeur).
   *
   * **Pas de court-circuit « no-op »** : une soumission dont le jeu est identique à la configuration active
   * crée quand même une proposition `pending` (le médecin la traite/rejette). Choix délibéré — comparer la
   * soumission à l'état courant impliquerait une lecture + normalisation de créneaux dans un chemin clinique,
   * non justifiée sans validation produit/médicale pour un simple confort de file de revue (medical-domain
   * validator, revue PR #714). Le bruit éventuel est borné par la supersession (1 pending / paramètre).
   * US-2663 (S0) — persiste `source` (provenance) et `baselineSlots` (snapshot de la base ISF/ICR active à
   * la génération, socle du compare-and-swap par créneau de S1). Additif : les lecteurs existants sont inchangés.
   *
   * ⚠️ **Anti-usurpation (ADR #27)** : `proposer` regroupe `{ userId, source }` — ils voyagent ENSEMBLE
   * (pas de désync possible entre l'auteur et la provenance). `source` est **REQUIS** (pas de défaut : un
   * appelant ne peut plus mislabel silencieusement une proposition `nurse`/`doctor`/`algorithme` en `patient`
   * → sinon la vue unifiée US-2664, qui filtre le patient sur `source=patient`, exposerait une dose non
   * validée). `source` DOIT être **dérivé du rôle de la SESSION côté route** (jamais du body). À S0, l'unique
   * appelant est la voie patient → `{ userId, source: "patient" }` ; `nurse`/`doctor`/`algorithm` en S3/S4.
   * @throws invalidSlotSet | emptySlotSet | zeroDurationSlot | valueOutOfBounds | slotOverlap | slotGap
   * @throws patientNotFound | nonInsulinNoDose | duplicatePendingProposal
   */
  async createSetProposal(
    patientId: number,
    parameterType: SlotSetParam,
    proposedSlots: ProposedSlot[],
    proposer: { userId: number; source: ProposalSource },
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

    // 4. Snapshot de la base PAR créneau à la génération (US-2663 S0) — photographie de la config ACTIVE
    //    juste avant la création. Consommé par le CAS par créneau de S1 (détection `baselineMoved`).
    const baselineSlots = await captureBaselineSlots(patientId, parameterType)

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
          data: { patientId, parameterType, proposedSlots: slots, baselineSlots, source: proposer.source, proposedByUserId: proposer.userId, status: "pending" },
          select: { id: true },
        })
        await auditService.logWithTx(tx, {
          userId: proposer.userId,
          action: "CREATE",
          resource: "SLOT_SET_PROPOSAL",
          resourceId: proposal.id,
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          requestId: ctx?.requestId,
          metadata: { patientId, kind: "slotSetProposalCreated", parameterType, source: proposer.source, slots: slots.length, baselineSlots: baselineSlots.length },
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
   * @throws nonInsulinNoDose (le mode dérivé a basculé non-insuliné entre création et acceptation — fail-closed)
   * @throws baselineMoved (US-2663 S1 — la base a dérivé depuis la génération : CAS d'ensemble rejeté, régénérer)
   * @throws baselineMissing (US-2663 S1 — proposition legacy sans snapshot de base : non certifiable, fail-closed)
   * @throws unsupportedSlotSetParam | invalidSlotSet | settingsNotFound | valueOutOfBounds | slotOverlap | slotGap | zeroDurationSlot | emptySlotSet
   */
  async acceptSetProposal(id: string, patientId: number, reviewerUserId: number, ctx?: AuditContext) {
    return prisma.$transaction(async (tx) => {
      const proposal = await tx.slotSetProposal.findFirst({
        where: { id, patientId, status: "pending", patient: { deletedAt: null } },
        select: { parameterType: true, proposedSlots: true, baselineSlots: true },
      })
      if (!proposal) throw new Error("slotSetProposalNotFound")

      // Garde runtime : le type DB `AdjustableParameter` est plus large (basalRate/fixedDose n'ont pas de
      // jeu de créneaux ISF/ICR). Le cast serait unsafe sans cette vérification (REPLACE_KEY undefined).
      const param = proposal.parameterType
      if (param !== "insulinSensitivityFactor" && param !== "insulinToCarbRatio") {
        throw new Error("unsupportedSlotSetParam")
      }
      const slots = parseSlots(proposal.proposedSlots)
      // US-2663 (S1) — snapshot de base à comparer au live sous verrou (CAS d'ensemble, dans `replaceSlotSet`).
      // `null` (proposition legacy pré-S0) est PRÉSERVÉ tel quel → `replaceSlotSet` lèvera `baselineMissing`
      // (fail-closed : jamais d'apply sur une base non certifiable). Parsé avec la même garde de forme que `slots`.
      const expectedBaseline = proposal.baselineSlots == null ? null : parseSlots(proposal.baselineSlots)

      // Frontière DISPOSITIF MÉDICAL re-vérifiée À L'ACCEPTATION (symétrie avec la création) : si le mode
      // dérivé serveur a basculé vers `nonInsulin` entre création et revue, on N'applique PAS un profil
      // ISF/ICR à un patient non insuliné (fail-closed, US-2651 §12.5). Rollback → proposition reste pending.
      const { mode } = await treatmentModeService.resolveTreatmentMode(patientId)
      if (mode === "nonInsulin") throw new Error("nonInsulinNoDose")

      // Compare-and-swap DANS la tx : verrouille l'acte pending → accepted. `count 0` = la proposition a
      // été rejetée/supersédée (ou acceptée) en course → throw → rollback (aucune config appliquée).
      const flipped = await tx.slotSetProposal.updateMany({
        where: { id, patientId, status: "pending" },
        data: { status: "accepted", reviewedByUserId: reviewerUserId, reviewedAt: new Date() },
      })
      if (flipped.count === 0) throw new Error("slotSetProposalNotFound")

      // Apply en bloc DANS la même transaction (atomicité). Un échec (bornes/couverture, OU CAS d'ensemble
      // `baselineMoved`/`baselineMissing`) propage l'exception → rollback du flip → la proposition reste
      // `pending` (fail-closed). `replaceSlotSet` vérifie le CAS sous verrou (`expectedBaseline`) puis supersède
      // au passage les autres propositions pending du paramètre.
      await insulinTherapyService.replaceSlotSet(REPLACE_KEY[param], patientId, slots, reviewerUserId, ctx, tx, { baseline: expectedBaseline })

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
      // US-2663 (S0, revue architecture) — `baselineSlots` est un snapshot INTERNE (socle du CAS d'acceptation
      // de S1), sans usage client avant la revue unifiée S2 : minimisation RGPD, ne pas l'exposer sur la liste.
      omit: { baselineSlots: true },
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

  /**
   * US-2663 (S2) — Liste les propositions d'ensemble **PENDING** d'un patient pour l'écran de REVUE MÉDECIN
   * (`/patients/[id]/review`), `baselineSlots` **INCLUS** (contrairement à `listSetProposals`, qui l'omet).
   *
   * ⚠️ Différence volontaire avec `listSetProposals` : cette liste est consommée par un écran DOCTOR-gated
   * (`canDecide`, cf. `ReviewClient`) qui construit un DIFF (base live vs `baselineSlots`/`proposedSlots`) pour
   * signaler au médecin une dérive de base (`isBaselineUnchanged`) AVANT sa décision — c'est du decision-support
   * clinicien légitime, pas une fuite de minimisation RGPD (le snapshot reste une donnée de config insuline,
   * jamais exposée côté patient).
   *
   * Audite le READ (les créneaux sont une donnée de config insuline — donnée de santé). Patient soft-deleted exclu.
   * @param auditUserId - PS effectuant la lecture (piste d'audit HDS).
   */
  async listPendingForReview(patientId: number, auditUserId: number, ctx?: AuditContext) {
    const proposals = await prisma.slotSetProposal.findMany({
      where: { patientId, status: "pending", patient: { deletedAt: null } },
      orderBy: { createdAt: "desc" },
      select: { id: true, parameterType: true, source: true, proposedSlots: true, baselineSlots: true, createdAt: true },
    })
    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "SLOT_SET_PROPOSAL",
      resourceId: String(patientId),
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      requestId: ctx?.requestId,
      metadata: { patientId, kind: "slotSetReview", count: proposals.length },
    })
    return proposals
  },
}
