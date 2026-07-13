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
 * l'index unique partiel `slot_set_proposals_one_pending_per_param_origin` (WHERE status = 'pending') ; la course
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
import { groupedSlotsSchema, slotRationaleSchema, type IsfIcrSlot, type PumpBasalSlot, type SlotRationale } from "@/lib/insulin/grouped-proposal"
import { pumpRowToGroupedSlot } from "@/lib/insulin/pump-time"
import { insulinTherapyService, assertValidSlotSet, assertValidPumpSlotSet } from "@/lib/services/insulin-therapy.service"
import { treatmentModeService } from "@/lib/services/treatment-mode.service"
import { auditService, type AuditContext } from "@/lib/services/audit.service"

/**
 * Créneau proposé (forme du JSON `proposedSlots`). US-2663 — **union par levier**, la **source de vérité de
 * forme unique** vit dans `src/lib/insulin/grouped-proposal.ts`. À S3c (PR-A) : ISF/ICR (`IsfIcrSlot`) + basale
 * POMPE (`PumpBasalSlot`). La basale STYLO et la dose fixe rejoignent l'union dans leurs PR dédiées.
 */
export type ProposedSlot = IsfIcrSlot | PumpBasalSlot

/**
 * Paramètres à jeu de créneaux gérés. US-2663 (S3c/PR-A) — élargi à `basalRate` (POMPE). La colonne DB
 * `parameter_type` accepte désormais aussi `fixedDose` (migration S3c/S3d) mais ce service ne l'émet/n'applique
 * pas encore (dose fixe = PR dédiée, identification par usage basal/bolus). `basalRate` **stylo** non plus (PR stylo).
 */
export type SlotSetParam = "insulinSensitivityFactor" | "insulinToCarbRatio" | "basalRate"

/** Mapping levier ISF/ICR → clé courte `replaceSlotSet`/verrou. `basalRate` n'y figure pas (voie `replacePumpSlotSet`). */
export const REPLACE_KEY: Record<"insulinSensitivityFactor" | "insulinToCarbRatio", "isf" | "icr"> = {
  insulinSensitivityFactor: "isf",
  insulinToCarbRatio: "icr",
}

/** Garde de type : un créneau groupé est-il de forme POMPE (`startTime`) plutôt qu'ISF/ICR (`startHour`) ? */
const isPumpSlot = (s: ProposedSlot): s is PumpBasalSlot => "startTime" in s

/**
 * Parse + valide la FORME du jeu pour un levier donné (union discriminée `groupedSlotsSchema`). `invalidSlotSet`
 * si malformé. Les bornes CLINIQUES + couverture sont vérifiées séparément (`assertValidSlotSet`/`assertValidPumpSlotSet`).
 * Un jeu vide passe la forme → rejeté en aval (`emptySlotSet`) — contrat stable.
 */
function parseSlots(param: SlotSetParam, raw: unknown): ProposedSlot[] {
  const parsed = groupedSlotsSchema(param).safeParse(raw)
  if (!parsed.success) throw new Error("invalidSlotSet")
  return parsed.data as ProposedSlot[]
}

/**
 * Dispatch de la validité CLINIQUE + couverture par levier (source unique par forme) :
 * ISF/ICR → `assertValidSlotSet` ; basale POMPE → `assertValidPumpSlotSet`. Un `basalRate` de forme STYLO
 * (pas de `startTime`) n'est pas géré en PR-A → `unsupportedSlotSetParam` (fail-closed).
 */
function assertValidGroupedSet(param: SlotSetParam, slots: ProposedSlot[]): void {
  if (param === "insulinSensitivityFactor") assertValidSlotSet("isf", slots as IsfIcrSlot[])
  else if (param === "insulinToCarbRatio") assertValidSlotSet("icr", slots as IsfIcrSlot[])
  else {
    // basalRate — PR-A ne gère que la POMPE. Un jeu non-pompe (stylo) est rejeté ici (fail-closed).
    if (!slots.every(isPumpSlot)) throw new Error("unsupportedSlotSetParam")
    assertValidPumpSlotSet(slots as PumpBasalSlot[])
  }
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
  if (parameterType === "insulinToCarbRatio") {
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
  // basalRate (POMPE, S3c/PR-A) — snapshot des `PumpBasalSlot` de l'UNIQUE `BasalConfiguration` du patient,
  // même forme que `PumpBasalSlot` groupé (`startTime`/`endTime` en `"HH:MM"`, `rate` U/h). Un patient NON pompe
  // (stylo, ou sans config basale) → `[]` : aucune base pompe (l'émetteur moteur ne crée pas de proposition
  // pompe pour un tel patient ; défensif). Scope via `settings.patientId` (1 config/patient — symétrie apply).
  const pumpRows = await prisma.pumpBasalSlot.findMany({
    where: { basalConfig: { settings: { patientId }, configType: "pump" } },
    orderBy: { startTime: "asc" },
    select: { startTime: true, endTime: true, rate: true },
  })
  return pumpRows.map(pumpRowToGroupedSlot)
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
   * @throws rationaleRequired (US-2663 S3b-0a — `source: "algorithm"` sans rationale par créneau ; contrat serveur)
   */
  async createSetProposal(input: {
    patientId: number
    parameterType: SlotSetParam
    proposedSlots: ProposedSlot[]
    // US-2663 (S3b-0a) — `userId` NULLABLE : la voie MOTEUR (`source: "algorithm"`) n'a pas d'utilisateur
    // (parité `createEngineProposal`, `proposedByUserId: null`). `source` reste dérivé SERVEUR (ADR #27).
    proposer: { userId: number | null; source: ProposalSource }
    ctx?: AuditContext
    // US-2663 (S3b-0a) — rationale PAR CRÉNEAU CHANGÉ, REQUISE si `source: "algorithm"` (decision-support +
    // traçabilité HDS), ignorée sinon (propositions humaines). Appariée au créneau par sa clé (`startHour`/`startTime`).
    rationale?: SlotRationale[] | null
    // US-2663 (S3b-1, revue architecture/medical) — snapshot de base INJECTÉ. Quand fourni (voie MOTEUR
    // groupée), il REMPLACE la relecture `captureBaselineSlots` : l'appelant a déjà lu la config LIVE une fois
    // pour bâtir sa disposition (overlay), et passe CETTE MÊME lecture comme base → disposition et
    // `baselineSlots` partagent UN seul instant, fermant la micro-fenêtre TOCTOU (une édition médecin d'un
    // créneau NON modifié par l'overlay lèvera `baselineMoved` à l'acceptation, au lieu d'être silencieusement
    // écrasée). Absent (voie patient) → snapshot capturé ici comme avant. Forme identique à `captureBaselineSlots`.
    baselineOverride?: ProposedSlot[]
  }) {
    // US-2663 (S3c/PR-A, revue architecture) — signature migrée en OBJET D'OPTIONS : `createSetProposal` porte
    // désormais des optionnels contextuels (ctx/rationale/baselineOverride) ET sert 3 leviers (ISF/ICR/basalRate) ;
    // les args positionnels devenaient fragiles (risque de désaligner ctx ⇄ rationale). Anti-usurpation inchangé.
    const { patientId, parameterType, proposedSlots, proposer, ctx, rationale, baselineOverride } = input
    // 1. Forme (Zod, par levier) puis validité clinique/couverture — fail-fast, AVANT tout accès DB (symétrie
    //    création ⇄ acceptation : une proposition inacceptable ne doit pas pouvoir être créée).
    const slots = parseSlots(parameterType, proposedSlots)
    assertValidGroupedSet(parameterType, slots)

    // 1-bis. US-2663 (S3b-0a) — une proposition MOTEUR DOIT porter sa rationale (medical HIGH : le médecin ne
    // décide pas sur un diff nu). Forme validée ; les entrées humaines ne persistent aucune rationale.
    const isAlgorithm = proposer.source === "algorithm"
    // Parité identité ⇄ provenance (revue S3b-0a) : l'ALGORITHME n'a pas d'utilisateur (`userId: null`),
    // une proposition HUMAINE en a toujours un. Contrat serveur (jamais un input humain) — durcit l'anti-usurpation.
    if (isAlgorithm !== (proposer.userId === null)) throw new Error("invalidProposerIdentity")
    let rationaleToPersist: SlotRationale[] | null = null
    if (isAlgorithm) {
      const parsed = z.array(slotRationaleSchema).safeParse(rationale)
      if (!parsed.success || parsed.data.length === 0) throw new Error("rationaleRequired")
      rationaleToPersist = parsed.data
    }

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
    //    US-2663 (S3b-1) — si l'appelant a injecté sa propre lecture LIVE (voie MOTEUR groupée), on la RÉUTILISE
    //    au lieu de re-lire : disposition et base partagent alors un seul instant (fenêtre TOCTOU fermée).
    const baselineSlots = baselineOverride ?? await captureBaselineSlots(patientId, parameterType)

    try {
      return await prisma.$transaction(async (tx) => {
        // US-2663 (S3b-0a / décision produit D2) — supersession PAR CLASSE D'ORIGINE : l'ALGORITHME ne
        // supersède que l'algorithme, l'HUMAIN que l'humain → une proposition MOTEUR et une demande HUMAINE
        // (patient/infirmier/médecin) COEXISTENT sur le même paramètre (le médecin voit les DEUX ; l'algo est
        // la « 2e proposition »). Garanti EN BASE par l'index partiel discriminé `..._origin` (source='algorithm').
        // Filtre d'origine appliqué AUX DEUX modèles (groupé `SlotSetProposal` + par-valeur `AdjustmentProposal`).
        const originFilter = isAlgorithm
          ? { source: "algorithm" as const }
          : { source: { not: "algorithm" as const } }
        await tx.slotSetProposal.updateMany({
          where: { patientId, parameterType, status: "pending", ...originFilter },
          data: { status: "superseded" },
        })
        // `reviewedBy: null` — supersession PROGRAMMATIQUE, pas une revue médecin (éviter un reviewer trompeur).
        await tx.adjustmentProposal.updateMany({
          where: { patientId, parameterType, status: "pending", ...originFilter },
          data: { status: "superseded", reviewedAt: new Date(), reviewedBy: null },
        })
        const proposal = await tx.slotSetProposal.create({
          data: { patientId, parameterType, proposedSlots: slots, baselineSlots, rationale: rationaleToPersist ?? undefined, source: proposer.source, proposedByUserId: proposer.userId, status: "pending" },
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
          // Rationale tracée (nb de créneaux justifiés) pour l'audit HDS de la recommandation moteur.
          metadata: { patientId, kind: "slotSetProposalCreated", parameterType, source: proposer.source, slots: slots.length, baselineSlots: baselineSlots.length, rationaleSlots: rationaleToPersist?.length ?? 0 },
        })
        return { id: proposal.id }
      })
    } catch (e) {
      // Course TOCTOU (deux soumissions simultanées) rattrapée par l'index partiel unique
      // `slot_set_proposals_one_pending_per_param_origin`. `isUniqueViolationOn` lit la forme d'erreur Prisma 7 +
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
   * @throws slotsBusy | basalConfigNotFound | basalConfigNotPump | rateNotDeliverable (US-2663 S3c — voie POMPE via `replacePumpSlotSet` : verrou occupé, config basale absente, patient devenu stylo, débit non délivrable)
   */
  async acceptSetProposal(id: string, patientId: number, reviewerUserId: number, ctx?: AuditContext) {
    return prisma.$transaction(async (tx) => {
      const proposal = await tx.slotSetProposal.findFirst({
        where: { id, patientId, status: "pending", patient: { deletedAt: null } },
        select: { parameterType: true, proposedSlots: true, baselineSlots: true },
      })
      if (!proposal) throw new Error("slotSetProposalNotFound")

      // Garde runtime : le type DB `AdjustableParameter` est plus large. PR-A gère ISF/ICR + basalRate POMPE ;
      // `fixedDose` (et basalRate STYLO) → `unsupportedSlotSetParam` (fail-closed, PR dédiées).
      const param = proposal.parameterType
      if (param !== "insulinSensitivityFactor" && param !== "insulinToCarbRatio" && param !== "basalRate") {
        throw new Error("unsupportedSlotSetParam")
      }
      const slots = parseSlots(param, proposal.proposedSlots)
      // US-2663 (S1) — snapshot de base à comparer au live sous verrou (CAS d'ensemble). `null` (proposition
      // legacy pré-S0) est PRÉSERVÉ tel quel → le `replace*` lèvera `baselineMissing` (fail-closed : jamais
      // d'apply sur une base non certifiable). Parsé avec la même garde de forme (par levier) que `slots`.
      const expectedBaseline = proposal.baselineSlots == null ? null : parseSlots(param, proposal.baselineSlots)

      // Frontière DISPOSITIF MÉDICAL re-vérifiée À L'ACCEPTATION (symétrie avec la création) : si le mode
      // dérivé serveur a basculé vers `nonInsulin` entre création et revue, on N'applique PAS un profil
      // à un patient non insuliné (fail-closed, US-2651 §12.5). Rollback → proposition reste pending.
      const { mode } = await treatmentModeService.resolveTreatmentMode(patientId)
      if (mode === "nonInsulin") throw new Error("nonInsulinNoDose")

      // Compare-and-swap DANS la tx : verrouille l'acte pending → accepted. `count 0` = la proposition a
      // été rejetée/supersédée (ou acceptée) en course → throw → rollback (aucune config appliquée).
      const flipped = await tx.slotSetProposal.updateMany({
        where: { id, patientId, status: "pending" },
        data: { status: "accepted", reviewedByUserId: reviewerUserId, reviewedAt: new Date() },
      })
      if (flipped.count === 0) throw new Error("slotSetProposalNotFound")

      // Apply en bloc DANS la même transaction (atomicité) — routage par levier. Un échec (bornes/couverture,
      // OU CAS d'ensemble `baselineMoved`/`baselineMissing`) propage l'exception → rollback du flip → la
      // proposition reste `pending` (fail-closed). Chaque `replace*` vérifie le CAS sous verrou (`expectedBaseline`)
      // puis supersède au passage les autres propositions pending du paramètre.
      if (param === "basalRate") {
        // PR-A : POMPE uniquement. Un jeu de forme STYLO (pas de `startTime`) → `unsupportedSlotSetParam`
        // (fail-closed ; la basale stylo groupée arrive dans sa PR dédiée). `replacePumpSlotSet` re-garde
        // aussi le `configType` LIVE (`basalConfigNotPump`) → jamais un jeu pompe écrit sur un patient stylo.
        if (!slots.every(isPumpSlot)) throw new Error("unsupportedSlotSetParam")
        await insulinTherapyService.replacePumpSlotSet(patientId, slots as PumpBasalSlot[], reviewerUserId, ctx, tx, {
          baseline: expectedBaseline as PumpBasalSlot[] | null,
        })
      } else {
        await insulinTherapyService.replaceSlotSet(REPLACE_KEY[param], patientId, slots as IsfIcrSlot[], reviewerUserId, ctx, tx, {
          baseline: expectedBaseline as IsfIcrSlot[] | null,
        })
      }

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
   * ⚠️ Différence volontaire avec `listSetProposals` : cette liste alimente l'écran de revue **clinicien**
   * (accès en LECTURE = `canAccessPatient`, donc DOCTOR **et NURSE** ; seule la DÉCISION accept/reject est
   * DOCTOR/ADMIN via `canDecide`). Elle construit un DIFF (base live vs `baselineSlots`/`proposedSlots`) pour
   * signaler une dérive de base (`isBaselineUnchanged`) AVANT décision — decision-support clinicien légitime,
   * pas une fuite de minimisation RGPD : le snapshot reste une donnée de **config insuline** (non-PHI) que le
   * soignant lit déjà en live, jamais exposée côté patient (la liste patient garde l'`omit`).
   *
   * Audite le READ (les créneaux sont une donnée de config insuline — donnée de santé). Patient soft-deleted exclu.
   *
   * US-2663 (S3b-0b) — inclut aussi `rationale` (JSON, rationale MOTEUR par créneau changé, non-null
   * uniquement si `source: "algorithm"`) : la revue affiche le motif/la confiance/le volume d'observations
   * MOTEUR à côté du diff, pour decision-support clinicien (jamais affichée côté patient).
   * @param auditUserId - PS effectuant la lecture (piste d'audit HDS).
   */
  async listPendingForReview(patientId: number, auditUserId: number, ctx?: AuditContext) {
    const proposals = await prisma.slotSetProposal.findMany({
      where: { patientId, status: "pending", patient: { deletedAt: null } },
      orderBy: { createdAt: "desc" },
      // US-2663 (S3b-0b) — `rationale` inclus : rationale MOTEUR par créneau changé (source=algorithm
      // uniquement, cf. `grouped-proposal.ts`), affichée à la revue médecin (decision-support + traçabilité HDS).
      select: { id: true, parameterType: true, source: true, proposedSlots: true, baselineSlots: true, rationale: true, createdAt: true },
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
