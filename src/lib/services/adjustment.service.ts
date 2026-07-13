/**
 * @module adjustment.service
 * @description Adjustment proposals — suggestions for ISF/ICR/basal changes based on data analysis.
 * Proposals are immutable once created and require doctor review (DOCTOR-only accept/reject).
 * Clinical bounds enforced before application.
 * @see CLAUDE.md#adjustment-proposals — Proposal workflow and clinical bounds
 */

import { prisma } from "@/lib/db/client"
import { isUniqueViolationOn } from "@/lib/db/prisma-errors"
import { auditService } from "./audit.service"
import { treatmentModeService } from "./treatment-mode.service"
import { clinicalReviewFlagService } from "./clinical-review-flag.service"
import { fcmService } from "./fcm.service"
import { logger } from "@/lib/logger"
import { INSULIN_BOUNDS } from "./insulin-therapy.service"
import { isDeliverableBasalRate, isDeliverableFixedDose } from "@/lib/clinical-bounds"
import { activeInsulinFilter } from "@/lib/insulin/active-insulin"
import { encryptField } from "@/lib/crypto/fields"
import type { AuditContext } from "./patient.service"
import type {
  ProposalStatus, Prisma, AdjustableParameter, AdjustmentReason, ProposalSource, ConfidenceLevel, DoseMoment, BasalDoseKind,
} from "@prisma/client"

/**
 * Entrée d'une proposition MOTEUR (US-2651) : candidat d'analyseur + discriminateurs de créneau.
 * Métriques moteur (`confidence`/`supportingEvents`) OBLIGATOIRES (contrainte CHECK `algorithm`).
 */
export type CreateEngineProposalInput = {
  patientId: number
  parameterType: AdjustableParameter
  proposedValue: number
  /** `currentValue` du SNAPSHOT sur lequel l'analyseur a calculé `proposedValue` (candidat).
   *  Sert au compare-and-swap de persistance (rejet si la config a dérivé depuis l'analyse). */
  expectedCurrentValue: number
  reason: AdjustmentReason
  confidence: ConfidenceLevel
  supportingEvents: number
  totalEventsConsidered?: number | null
  averageObservedValue?: number | null
  analysisPeriod?: string | null
  dataQuality?: string | null
  timeSlotStartHour?: number | null
  timeSlotEndHour?: number | null
  carbRatioSlotStart?: number | null
  carbRatioSlotEnd?: number | null
  pumpBasalSlotId?: string | null
  /** Discriminateur de créneau pour la DOSE FIXE (mode « doses simples »). */
  moment?: DoseMoment | null
  /** US-2659 — discriminateur de CIBLE d'une basale STYLO (MDI). `daily` (single_injection),
   *  `morning`/`evening` (split_injection) → `BasalConfiguration.dailyDose`/`morning`/`eveningDose`.
   *  Exclusif de `pumpBasalSlotId` pour `basalRate` (CHECK base). */
  basalDoseKind?: BasalDoseKind | null
}

/** Sources humaines d'une proposition (l'algorithme passe par le chemin `algorithm`). */
type HumanProposerRole = Extract<ProposalSource, "patient" | "nurse" | "doctor">

/** Entrée STRUCTURÉE d'une proposition humaine (US-2649a). La provenance est
 *  dérivée du `proposer` authentifié, jamais du corps de requête (anti-usurpation). */
export type CreateProposalInput = {
  patientId: number
  parameterType: AdjustableParameter
  proposedValue: number
  reason: AdjustmentReason
  timeSlotStartHour?: number | null
  timeSlotEndHour?: number | null
  carbRatioSlotStart?: number | null
  carbRatioSlotEnd?: number | null
  pumpBasalSlotId?: string | null
  /** Discriminateur de créneau pour la DOSE FIXE (mode « doses simples »). */
  moment?: DoseMoment | null
  /** US-2659 — discriminateur de CIBLE d'une basale STYLO (MDI). Exclusif de `pumpBasalSlotId`. */
  basalDoseKind?: BasalDoseKind | null
  /** US-2659 (S3) — accusé DKA/jour-de-maladie du patient (consentement au risque de cétose d'une baisse
   *  basale). Requis `=== true` pour une baisse STYLO ; optionnel/persisté pour la pompe. */
  sickDayAcknowledged?: boolean
  /** Justification texte libre — chiffrée AES-256-GCM au stockage. */
  proposerComment?: string | null
}

/**
 * Validate proposed parameter value against clinical bounds.
 * @private
 * @param {string} parameterType - Parameter type (insulinSensitivityFactor, insulinToCarbRatio, basalRate)
 * @param {number} value - Proposed value
 * @returns {boolean} True if value is within bounds
 */
/**
 * Garde-fő fail-closed de l'application d'une proposition acceptée : si aucune ligne n'a
 * été écrite (`count === 0` — créneau supprimé/déplacé ou hors patient entre la proposition
 * et l'accept), lève `code` → rollback de la transaction, jamais d'« accepté + appliqué »
 * fantôme. Partagé par les 3 paramètres (ISF/ICR/basal) pour éviter la dérive.
 */
function assertRowApplied(count: number, code: string): void {
  if (count === 0) throw new Error(code)
}

/**
 * Sens clinique impliqué par un `reason` de titration : `*TooLow` ⇒ HAUSSE, `*TooHigh` ⇒ BAISSE.
 * `null` pour un motif non directionnel (`*Correct`, `insufficientData`, motifs humains). Sert à
 * vérifier la cohérence `reason` ↔ signe du delta d'une proposition moteur (US-2651).
 *
 * US-2663 (S3b-1) — EXPORTÉ : la voie GROUPÉE (`emitGroupedIsfIcr`, proposal-generator) réapplique cette
 * garde défense-en-profondeur avant d'assembler la disposition (parité avec `reasonDirectionMismatch`
 * ci-dessous, que `createSetProposal` ne re-vérifie pas).
 */
export function reasonImpliesIncrease(reason: AdjustmentReason): boolean | null {
  if (reason.endsWith("TooLow")) return true
  if (reason.endsWith("TooHigh")) return false
  return null
}

function validateProposedValue(
  parameterType: string,
  value: number,
  basalDoseKind?: BasalDoseKind | null,
): boolean {
  switch (parameterType) {
    case "insulinSensitivityFactor":
      return value >= INSULIN_BOUNDS.ISF_GL_MIN && value <= INSULIN_BOUNDS.ISF_GL_MAX
    case "insulinToCarbRatio":
      return value >= INSULIN_BOUNDS.ICR_MIN && value <= INSULIN_BOUNDS.ICR_MAX
    case "basalRate":
      // US-2659 — basale STYLO (MDI, `basalDoseKind` fourni) : dose en UNITÉS TOTALES. Bornes propres
      // (`MDI_BASAL_MIN_U`, pas de plafond dur — U300/dégludec légitimes > 80 U ; le WARN est non
      // bloquant), délivrable à la demi-unité (`isDeliverableFixedDose`). JAMAIS les bornes pompe (U/h).
      if (basalDoseKind != null) {
        return value >= INSULIN_BOUNDS.MDI_BASAL_MIN_U && isDeliverableFixedDose(value)
      }
      // US-2648b — basale POMPE : débit PROGRAMMABLE = multiple de `PUMP_BASAL_INCREMENT` (0,05 U/h),
      // dans [BASAL_MIN ; BASAL_MAX]. Rejet à la création si non délivrable (profil rejeté à l'application).
      return (
        value >= INSULIN_BOUNDS.BASAL_MIN &&
        value <= INSULIN_BOUNDS.BASAL_MAX &&
        isDeliverableBasalRate(value)
      )
    // US-2646 — dose fixe (mode « doses simples »). SEUL le plancher de sanité bloque
    // (dose ≤ 0 / < 0,5 U invalide). PAS de plafond bloquant : une basale fixe peut
    // dépasser 25 U ; le dépassement des seuils théoriques (FIXED_BOLUS/BASAL_WARN_U)
    // déclenche un AVERTISSEMENT au service, pas un rejet. Delta/sens interdit patient
    // vérifiés à la création (service), pas ici.
    case "fixedDose":
      return value >= INSULIN_BOUNDS.FIXED_DOSE_MIN
    default:
      return false
  }
}

/**
 * US-2649a — valeur COURANTE de confiance d'un paramètre, lue **serveur** depuis la
 * config réelle du patient (jamais du body → garde-fous ininviolables) et **scopée
 * patient** (anti-IDOR : le créneau doit appartenir au patient).
 * @throws `slotRequired` (créneau/`moment` manquant), `currentValueNotFound` (créneau absent /
 *   autre patient). La dose fixe (US-2652) est ciblée par `moment` (scopée patient via `patientInsulin`).
 */
async function resolveCurrentValue(
  patientId: number,
  parameterType: AdjustableParameter,
  input: CreateProposalInput,
): Promise<number> {
  switch (parameterType) {
    case "insulinSensitivityFactor": {
      if (input.timeSlotStartHour == null) throw new Error("slotRequired")
      const row = await prisma.insulinSensitivityFactor.findFirst({
        where: { settings: { patientId }, startHour: input.timeSlotStartHour },
        select: { sensitivityFactorGl: true },
      })
      if (!row) throw new Error("currentValueNotFound")
      return Number(row.sensitivityFactorGl)
    }
    case "insulinToCarbRatio": {
      if (input.carbRatioSlotStart == null) throw new Error("slotRequired")
      const row = await prisma.carbRatio.findFirst({
        where: { settings: { patientId }, startHour: input.carbRatioSlotStart },
        select: { gramsPerUnit: true },
      })
      if (!row) throw new Error("currentValueNotFound")
      return Number(row.gramsPerUnit)
    }
    case "basalRate": {
      // US-2659 — basale STYLO (MDI) : ciblée par `basalDoseKind` (daily/morning/evening) sur
      // `BasalConfiguration` (scopée patient via `settings`, anti-IDOR). Dose en UNITÉS TOTALES.
      if (input.basalDoseKind != null) {
        const cfg = await prisma.basalConfiguration.findFirst({
          where: { settings: { patientId } },
          select: { dailyDose: true, morningDose: true, eveningDose: true },
        })
        if (!cfg) throw new Error("currentValueNotFound")
        const dose =
          input.basalDoseKind === "daily" ? cfg.dailyDose
          : input.basalDoseKind === "morning" ? cfg.morningDose
          : cfg.eveningDose
        if (dose == null) throw new Error("currentValueNotFound") // dose non configurée → fail-closed
        return Number(dose)
      }
      // Basale POMPE : ciblée par `pumpBasalSlotId` (créneau U/h), scopée patient.
      if (!input.pumpBasalSlotId) throw new Error("slotRequired")
      const row = await prisma.pumpBasalSlot.findFirst({
        where: { id: input.pumpBasalSlotId, basalConfig: { settings: { patientId } } },
        select: { rate: true },
      })
      if (!row) throw new Error("currentValueNotFound")
      return Number(row.rate)
    }
    // Dose fixe (US-2652) : ciblée par `moment` (colonne discriminante sur AdjustmentProposal).
    // Valeur courante lue SERVEUR depuis la `FixedDoseSlot` du patient (anti-IDOR : scopée patient).
    case "fixedDose": {
      if (!input.moment) throw new Error("slotRequired")
      const row = await prisma.fixedDoseSlot.findFirst({
        // US-2663 (S3d, revue) — filtre insuline ACTIVE : ne lit jamais la dose d'une insuline discontinuée.
        where: { patientInsulin: { patientId, ...activeInsulinFilter() }, moment: input.moment },
        select: { valueU: true },
      })
      if (!row) throw new Error("currentValueNotFound")
      return Number(row.valueU)
    }
    default:
      throw new Error("unsupportedParameter")
  }
}

/**
 * US-2649a — ne conserve que le(s) discriminateur(s) de créneau PERTINENT(s) pour le
 * paramètre (les autres à `null`). Garantit que le pré-check ET l'index anti-spam ne
 * portent que le discriminateur réellement validé par `resolveCurrentValue` : sinon un
 * champ de créneau parasite (ex. un `pumpBasalSlotId` attaché à une proposition ISF)
 * ferait varier le tuple d'unicité et permettrait des doublons `pending`.
 */
function slotFieldsFor(parameterType: AdjustableParameter, input: CreateProposalInput) {
  const empty = {
    timeSlotStartHour: null as number | null,
    timeSlotEndHour: null as number | null,
    carbRatioSlotStart: null as number | null,
    carbRatioSlotEnd: null as number | null,
    pumpBasalSlotId: null as string | null,
    moment: null as DoseMoment | null,
    // US-2659 — discriminateur basale STYLO (exclusif de pumpBasalSlotId pour basalRate).
    basalDoseKind: null as BasalDoseKind | null,
  }
  switch (parameterType) {
    case "insulinSensitivityFactor":
      return { ...empty, timeSlotStartHour: input.timeSlotStartHour ?? null, timeSlotEndHour: input.timeSlotEndHour ?? null }
    case "insulinToCarbRatio":
      return { ...empty, carbRatioSlotStart: input.carbRatioSlotStart ?? null, carbRatioSlotEnd: input.carbRatioSlotEnd ?? null }
    // US-2659 — basalRate : POMPE (pumpBasalSlotId, U/h) OU STYLO (basalDoseKind, U totales), exclusif.
    // On ne conserve que le discriminateur fourni → le tuple d'unicité anti-spam reste correct.
    case "basalRate":
      return { ...empty, pumpBasalSlotId: input.pumpBasalSlotId ?? null, basalDoseKind: input.basalDoseKind ?? null }
    case "fixedDose":
      return { ...empty, moment: input.moment ?? null }
    default:
      return empty
  }
}

/**
 * Adjustment proposal service — CRUD and review workflow.
 * @namespace adjustmentService
 */
/**
 * US-2649b — Notifie le médecin RÉFÉRENT du patient qu'une proposition d'ajustement est à
 * revoir (push FCM). Best-effort et hors transaction (jamais bloquant pour la création). Ne
 * se notifie pas soi-même (un référent qui propose). Aucun PHI/valeur de dose dans le message.
 */
async function notifyReviewers(
  patientId: number,
  proposal: { id: string; proposedByUserId: number | null },
  ctx?: AuditContext,
): Promise<{ notified: boolean }> {
  const ref = await prisma.patientReferent.findFirst({
    where: { patientId, patient: { deletedAt: null } },
    select: { pro: { select: { userId: true } } },
  })
  const reviewerUserId = ref?.pro?.userId
  if (!reviewerUserId || reviewerUserId === proposal.proposedByUserId) return { notified: false }

  try {
    const result = await fcmService.sendToUser(
      {
        userId: reviewerUserId,
        senderId: proposal.proposedByUserId ?? reviewerUserId,
        title: "Nouvelle proposition d'ajustement",
        body: "Une proposition d'ajustement de traitement est en attente de votre validation.",
        data: { type: "proposal_review", proposalId: proposal.id },
      },
      ctx,
    )
    return { notified: result.sent > 0 }
  } catch (err) {
    logger.error("adjustment", "Reviewer push notification failed", { patientId }, err)
    return { notified: false }
  }
}

/**
 * US-2663 (S2b) — EXCLUSION MUTUELLE grouped ⇄ par-valeur. À la création d'une proposition PAR-VALEUR
 * (`AdjustmentProposal`, quelle que soit la primitive : humaine, moteur, manuelle DOCTOR), supersède les
 * propositions d'ENSEMBLE (`SlotSetProposal`) pending du **même paramètre** — symétrique de `createSetProposal`
 * (qui supersède déjà les par-valeur). Garantit « 1 file pending / (patient × paramètre) » à travers LES DEUX
 * modèles (décision produit, trajectoire grouped-only ; medical GO : garder la symétrie, y compris moteur).
 *
 * `reviewedByUserId: null` = supersession **programmatique** (pas une revue médecin — évite une attribution
 * trompeuse en forensic). Hors ISF/ICR (`basalRate`/`fixedDose`) : aucune `SlotSetProposal` n'existe →
 * `updateMany` matche 0 ligne (no-op). Appelé DANS la transaction de création (atomicité : rollback commun).
 * @returns le nombre de propositions d'ensemble supersédées (tracé dans l'audit `CREATE`).
 */
async function supersedeGroupedPending(
  tx: Prisma.TransactionClient,
  patientId: number,
  parameterType: AdjustableParameter,
  // US-2663 (S3b-0a / décision produit D2) — `source` de la proposition CRÉÉE : la supersession est PAR
  // CLASSE D'ORIGINE (l'algorithme ne supersède que l'algorithme, l'humain que l'humain) → une proposition
  // groupée MOTEUR et une demande HUMAINE coexistent (le médecin voit les deux). Sans ce filtre, une
  // proposition MOTEUR par-valeur (basal/fixe, ou ISF/ICR flag OFF) effacerait une demande groupée patient.
  source: ProposalSource,
): Promise<number> {
  const originFilter = source === "algorithm" ? { source: "algorithm" as const } : { source: { not: "algorithm" as const } }
  const res = await tx.slotSetProposal.updateMany({
    where: { patientId, parameterType, status: "pending", ...originFilter },
    data: { status: "superseded", reviewedAt: new Date(), reviewedByUserId: null },
  })
  return res.count
}

export const adjustmentService = {
  /**
   * List adjustment proposals for a patient with optional filters.
   * @async
   * @param {number} patientId - Patient ID
   * @param {Object} filters - Query filters (status, parameterType, date range)
   * @param {number} auditUserId - User performing read (audit trail)
   * @param {AuditContext} [ctx] - Request context (IP, User-Agent)
   * @returns {Promise<Array<Object>>} Proposals matching filters, newest first
   */
  async list(
    patientId: number,
    filters: {
      status?: ProposalStatus
      parameterType?: string
      from?: Date
      to?: Date
      // Étape 1 vue unifiée — restriction de PROVENANCE imposée SERVEUR (jamais depuis le body/query).
      // Sûreté (medical) : un patient ne doit recevoir QUE ses propres demandes (`["patient"]`) — voir une
      // dose non validée proposée par un soignant/l'algorithme l'exposerait à une auto-injection (ADR #13).
      // `undefined` = aucune restriction (clinicien : voit toutes les provenances).
      sources?: ProposalSource[]
    },
    auditUserId: number,
    ctx?: AuditContext,
  ) {
    const where: Prisma.AdjustmentProposalWhereInput = { patientId }
    if (filters.status) where.status = filters.status
    if (filters.parameterType) where.parameterType = filters.parameterType as Prisma.EnumAdjustableParameterFilter
    if (filters.sources) where.source = { in: filters.sources }
    if (filters.from || filters.to) {
      where.createdAt = {
        ...(filters.from && { gte: filters.from }),
        ...(filters.to && { lte: filters.to }),
      }
    }

    const proposals = await prisma.adjustmentProposal.findMany({
      where,
      orderBy: { createdAt: "desc" },
      // HDS — ne JAMAIS émettre le ciphertext `proposerComment` dans la réponse (CLAUDE.md).
      // Strippé au SERVICE : tout consommateur de `list()` est protégé, pas seulement la route.
      // Le décryptage pour le médecin relecteur sera une tranche dédiée (US-2649b).
      omit: { proposerComment: true },
    })

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "ADJUSTMENT_PROPOSAL",
      resourceId: String(patientId),
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
    })

    return proposals
  },

  /**
   * US-2649b — valeur COURANTE **LIVE** du créneau d'une proposition (re-lecture serveur au
   * moment de la revue), pour signaler au médecin si la config a changé depuis la proposition
   * (le `currentValue` stocké est un snapshot de création). Renvoie `null` si le créneau a
   * disparu/bougé (ISF/ICR par heure, basal par id, dose fixe par moment) ou n'est pas résoluble → l'UI n'affiche
   * alors pas de comparaison. Réutilise la lecture scopée patient de `resolveCurrentValue`.
   */
  async liveCurrentValue(
    patientId: number,
    proposal: {
      parameterType: AdjustableParameter
      timeSlotStartHour: number | null
      carbRatioSlotStart: number | null
      pumpBasalSlotId: string | null
      // US-2652 : sans `moment`, `resolveCurrentValue` lève `slotRequired` pour une dose fixe → CAS
      // `baselineMoved` inactif (une dose absolue périmée serait écrite). Doit être forwardé.
      moment: DoseMoment | null
      // US-2659 : idem pour la basale STYLO (résolution `dailyDose`/`morning`/`eveningDose`).
      basalDoseKind: BasalDoseKind | null
    },
  ): Promise<number | null> {
    try {
      return await resolveCurrentValue(patientId, proposal.parameterType, {
        patientId,
        parameterType: proposal.parameterType,
        proposedValue: 0,
        reason: "manualAdjustment",
        timeSlotStartHour: proposal.timeSlotStartHour,
        carbRatioSlotStart: proposal.carbRatioSlotStart,
        pumpBasalSlotId: proposal.pumpBasalSlotId,
        moment: proposal.moment,
        basalDoseKind: proposal.basalDoseKind,
      })
    } catch (err) {
      // Cas ATTENDUS (créneau absent/non résoluble) → null silencieux. Une erreur INATTENDUE
      // (panne DB, etc.) est loguée : sans ça, un échec de lecture masquerait l'avertissement
      // « config modifiée » sans trace (observabilité).
      const expected =
        err instanceof Error &&
        ["slotRequired", "currentValueNotFound"].includes(err.message)
      if (!expected) logger.error("adjustment", "liveCurrentValue read failed", { patientId }, err)
      return null
    }
  },

  /**
   * Get summary counts by status.
   * US-2664 — restriction de PROVENANCE optionnelle (`sources`), imposée SERVEUR (jamais du body/query),
   * cohérente avec `list()` : un PATIENT (VIEWER) ne doit compter QUE ses propres demandes (`["patient"]`).
   * Sans ce filtre, le compteur divulguerait l'EXISTENCE de propositions non validées d'un soignant/de
   * l'algorithme (métadonnée) — même frontière MDR que la liste (ADR #13). `undefined` = aucune restriction.
   */
  async summary(patientId: number, sources?: ProposalSource[]) {
    const src = sources ? { source: { in: sources } } : {}
    const [pending, accepted, rejected, expired] = await Promise.all([
      prisma.adjustmentProposal.count({ where: { patientId, status: "pending", ...src } }),
      prisma.adjustmentProposal.count({ where: { patientId, status: "accepted", ...src } }),
      prisma.adjustmentProposal.count({ where: { patientId, status: "rejected", ...src } }),
      prisma.adjustmentProposal.count({ where: { patientId, status: "expired", ...src } }),
    ])
    return { pending, accepted, rejected, expired, total: pending + accepted + rejected + expired }
  },

  /** Create a manual proposal (DOCTOR only) */
  async createManual(
    input: Prisma.AdjustmentProposalUncheckedCreateInput,
    auditUserId: number,
    ctx?: AuditContext,
  ) {
    // Frontière MDR (US-2651, §12.5) — MÊME invariant que `createProposal` : cette 2ᵉ primitive
    // de création ne doit JAMAIS émettre une proposition de dose pour un patient NON INSULINÉ,
    // quelle que soit la route qui la câblera un jour. Fail-fast avant toute écriture.
    const { mode } = await treatmentModeService.resolveTreatmentMode(input.patientId)
    if (mode === "nonInsulin") throw new Error("nonInsulinNoDose")

    // US-2663 (S3b-0a, revue prisma/medical HIGH) — cette primitive est DOCTOR-only : sa provenance par
    // défaut est HUMAINE (`doctor`), JAMAIS `algorithm`. On fixe la source une seule fois et on l'utilise à la
    // fois pour la PERSISTANCE et la CLASSIFICATION de supersession (cohérence D2) — sans quoi une proposition
    // médecin sans `source` explicite serait étiquetée algo (défaut DB `@default(algorithm)`) et supersèderait
    // la mauvaise classe. Un futur câblage route DOIT passer `source` dérivé de la session (ADR #27).
    const source: ProposalSource = input.source ?? "doctor"
    return prisma.$transaction(async (tx) => {
      const proposal = await tx.adjustmentProposal.create({ data: { ...input, source } })
      // Exclusion mutuelle PAR CLASSE (D2) : un acte médecin supersède les pending d'origine HUMAINE.
      const supersededGroupedCount = await supersedeGroupedPending(tx, input.patientId, input.parameterType, source)

      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "CREATE",
        resource: "ADJUSTMENT_PROPOSAL",
        resourceId: proposal.id,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        metadata: { patientId: input.patientId, supersededGroupedCount },
      })

      return proposal
    })
  },

  /**
   * US-2649a — Créer une proposition d'ajustement **humaine** (patient / infirmier /
   * médecin) depuis une entrée structurée. Garde-fous imposés SERVEUR :
   *  - provenance dérivée du `proposer` authentifié (jamais du body) ;
   *  - bornes cliniques vérifiées **à la création** (pas seulement à l'accept) ;
   *  - pour un PATIENT : cap de variation resserré (ratios en %) ; la **baisse de basale** est
   *    RELÂCHÉE mais GATÉE (US-2659 S3 : maturité + mode serveur + accusé DKA stylo) ; hausse basale
   *    et ISF/ICR seulement bornés en amplitude ;
   *  - anti-spam : 1 proposition `pending` max par (patient, paramètre, créneau) ;
   *  - métriques moteur (`confidence`/`supportingEvents`) NULLES (proposition humaine) ;
   *  - `proposerComment` chiffré ; jamais auto-appliqué (`status=pending`).
   */
  async createProposal(
    input: CreateProposalInput,
    proposer: { userId: number; role: HumanProposerRole },
    ctx?: AuditContext,
  ) {
    const { patientId, parameterType, proposedValue } = input

    // 0. Frontière DISPOSITIF MÉDICAL (US-2651, §12.5) : un patient NON INSULINÉ ne reçoit
    //    JAMAIS de proposition de DOSE. Le mode (c) relève d'un ClinicalReviewFlag (orientation
    //    « à revoir en consultation »), jamais d'une AdjustmentProposal. Mode dérivé SERVEUR
    //    (source de vérité, fail-closed : un DT1 n'est jamais classé nonInsulin).
    const { mode, maturityLevel } = await treatmentModeService.resolveTreatmentMode(patientId)
    if (mode === "nonInsulin") {
      // Tracer CHAQUE tentative refusée (y compris les répétitions malgré le flag idempotent →
      // observabilité d'une insistance/détresse croissante). Action distincte PROPOSAL_REFUSED,
      // aucune dose. Best-effort : un échec d'audit ne convertit pas le refus MDR en acceptation.
      await auditService
        .log({
          userId: proposer.userId,
          action: "PROPOSAL_REFUSED",
          resource: "ADJUSTMENT_PROPOSAL",
          resourceId: String(patientId),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          metadata: { patientId, proposedByRole: proposer.role, reason: "nonInsulinNoDose" },
        })
        .catch((err) => logger.error("adjustment", "audit refused attempt failed", { patientId }, err))

      // L'intention d'un PATIENT non insuliné ne doit pas être un cul-de-sac silencieux : on
      // lève un flag d'orientation (« à revoir en consultation ») pour le soignant. Idempotent
      // (anti-spam) + best-effort (un échec de flag ne change pas le refus MDR). Aucune posologie
      // dans le flag. Un clinicien (nurse/doctor) agit directement → pas de flag pour eux.
      if (proposer.role === "patient") {
        await clinicalReviewFlagService
          .raise(patientId, "reviewInConsultation", proposer.userId, ctx)
          .catch((err) => logger.error("adjustment", "raise review flag failed", { patientId }, err))
      }
      throw new Error("nonInsulinNoDose")
    }

    // 0bis. US-2659 S3 (E1) — pour une proposition PATIENT de `basalRate`, dériver le MODE de délivrance
    //    SERVEUR (config = source de vérité) et rejeter + AUDITER (E6) un discriminateur incohérent AVANT
    //    `resolveCurrentValue` : sinon un `basalDoseKind`/`pumpBasalSlotId` forgé serait masqué en
    //    `currentValueNotFound` (404) NON audité → la tentative d'usurpation de mode échapperait à la piste
    //    forensic. S'applique aux DEUX sens (défense en profondeur). `patientBasalIsPen` réutilisé par le gate baisse.
    let patientBasalIsPen = false
    if (proposer.role === "patient" && parameterType === "basalRate") {
      const cfg = await prisma.basalConfiguration.findFirst({
        where: { settings: { patientId } }, select: { configType: true },
      })
      const isPen = cfg?.configType === "single_injection" || cfg?.configType === "split_injection"
      const isPump = cfg?.configType === "pump"
      const deliveryMode = isPen ? "pen" : isPump ? "pump" : "unknown"
      const auditRefuse = async (reason: string) => {
        await auditService.log({
          userId: proposer.userId, action: "PROPOSAL_REFUSED", resource: "ADJUSTMENT_PROPOSAL",
          resourceId: String(patientId), ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent,
          metadata: { patientId, proposedByRole: "patient", deliveryMode, reason },
        }).catch((err) => logger.error("adjustment", "audit refused mode failed", { patientId }, err))
        throw new Error(reason)
      }
      if (input.basalDoseKind != null && !isPen) await auditRefuse("deliveryModeMismatch") // claim stylo sur non-stylo
      if (input.pumpBasalSlotId != null && !isPump) await auditRefuse("deliveryModeMismatch") // claim pompe sur non-pompe
      patientBasalIsPen = isPen
    }

    // 1. Bornes cliniques dures — rejet à la création (pas seulement à l'accept). `basalDoseKind` route
    //    les bornes basale STYLO (U totales) vs POMPE (U/h) — US-2659.
    if (!validateProposedValue(parameterType, proposedValue, input.basalDoseKind)) {
      throw new Error("valueOutOfBounds")
    }

    // 2. Valeur COURANTE de CONFIANCE, lue serveur (jamais du body) et scopée patient.
    //    Rejette fixedDose (non câblé) + créneau introuvable/d'un autre patient.
    const currentValue = await resolveCurrentValue(patientId, parameterType, input)

    const delta = proposedValue - currentValue
    const rawPct = currentValue !== 0 ? (delta / currentValue) * 100 : 0
    // Clamp à la précision de la colonne `Decimal(5,2)` (±999.99) — évite un numeric
    // overflow Postgres (ex. basale 0.05→5.0 = 9900 %) → insert 500. ⚠️ La valeur stockée
    // peut donc être saturée : l'UI de validation (US-2649b) DOIT recalculer/afficher
    // « > 999 % » depuis `currentValue`/`proposedValue` (stockés exacts), pas s'y fier.
    const changePercent = Math.max(-999.99, Math.min(999.99, rawPct))

    // Discriminateurs de créneau NORMALISÉS par paramètre (les parasites → null) :
    // évite qu'un champ non pertinent varie le tuple anti-spam (pré-check + index).
    const slot = slotFieldsFor(parameterType, input)

    // 3. Garde-fous PATIENT (sur l'écart de confiance ; une demande, pas une titration).
    //    `sickDayAckAt` / `decreaseAudit` sont posés par le gate BAISSE ci-dessous et consommés à la création.
    let sickDayAckAt: Date | null = null
    let decreaseAudit: Record<string, unknown> | null = null
    if (proposer.role === "patient") {
      const isDecrease = parameterType === "basalRate" && delta < 0
      if (isDecrease) {
        // US-2659 (S3, validé medical + HDS) — BAISSE de basale PATIENT : autrefois interdite
        // (`patientDecreaseForbidden`), désormais RELÂCHÉE mais gatée. Le médecin reste le garde-fou
        // (proposition `pending`, jamais auto-appliquée, ADR #13) ; interdire la proposition est anti-ETP.
        // Tout est lu SERVEUR (anti-tamper) : maturité, valeur courante, MODE de délivrance.
        const maturity = maturityLevel ?? "JUNIOR" // fail-closed : maturité absente → JUNIOR (le plus restrictif)
        // Mode déjà dérivé serveur + discriminateur incohérent déjà rejeté/audité en 0bis (E1). À ce stade,
        // `resolveCurrentValue` a réussi → la config est cohérente avec le discriminateur → `patientBasalIsPen` fiable.
        const isPen = patientBasalIsPen
        const deliveryMode = isPen ? "pen" : "pump"
        // Audit d'un refus (E6) : une insistance répétée à réduire son insuline est un signal clinique/forensic. Sans PHI.
        const refuse = async (reason: string) => {
          await auditService.log({
            userId: proposer.userId, action: "PROPOSAL_REFUSED", resource: "ADJUSTMENT_PROPOSAL",
            resourceId: String(patientId), ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent,
            metadata: { patientId, proposedByRole: "patient", direction: "decrease", deliveryMode, reason },
          }).catch((err) => logger.error("adjustment", "audit refused decrease failed", { patientId }, err))
          throw new Error(reason)
        }
        // Gate maturité par mode : stylo (dose entière, non réversible) → CONFIRME ; pompe (micro-débit
        // réversible) → dès INTERMEDIATE. JUNIOR : refus tous modes.
        const gateOk = isPen ? maturity === "CONFIRME" : maturity === "INTERMEDIATE" || maturity === "CONFIRME"
        if (!gateOk) await refuse("maturityTooLowForDecrease")
        // Accusé DKA (E2) : BLOQUANT pour le stylo (=== true STRICT) — réduire une basale lente en jour de
        // maladie augmente le risque de cétose/DKA. Non bloquant pompe (débit réversible) mais persisté si fourni (Q7).
        if (isPen && input.sickDayAcknowledged !== true) await refuse("dkaAcknowledgmentRequired")
        // Amplitude sur le VRAI delta (jamais le `changePercent` saturé ±999,99) : stylo min(10 %, 2 U), pompe 10 %.
        const pctCapU = (INSULIN_BOUNDS.PATIENT_MAX_CHANGE_PERCENT / 100) * currentValue
        const capU = isPen ? Math.min(pctCapU, INSULIN_BOUNDS.MDI_BASAL_PATIENT_MAX_DELTA_U) : pctCapU
        if (Math.abs(delta) > capU + 1e-9) await refuse("patientDeltaTooLarge")
        // Snap incrément stylo : une baisse infra-incrément (défaut 1 U) ou non délivrable (½ U) = non actionnable → rejet.
        if (isPen && (Math.abs(delta) < INSULIN_BOUNDS.MDI_BASAL_DELIVERY_INCREMENT_U - 1e-9 || !isDeliverableFixedDose(proposedValue))) {
          await refuse("noChangeProposed")
        }
        // Consentement DKA persisté (timestamp immuable) si fourni (requis stylo, optionnel pompe) ; audit enrichi (E3).
        sickDayAckAt = input.sickDayAcknowledged === true ? new Date() : null
        decreaseAudit = { direction: "decrease", deliveryMode, dkaAcknowledged: input.sickDayAcknowledged === true, maturityAtDecision: maturity }
      } else if (Math.abs(changePercent) > INSULIN_BOUNDS.PATIENT_MAX_CHANGE_PERCENT) {
        // HAUSSE basalRate / ISF / ICR : cap % inchangé (seule la BAISSE basale était le garde-fou relâché).
        throw new Error("patientDeltaTooLarge")
      }

      // Cooldown anti-churn (US-2650, épic §6) : une seule proposition patient par (paramètre ×
      // créneau) toutes les PATIENT_PROPOSAL_COOLDOWN_HOURS, décomptée depuis la RÉSOLUTION de la
      // dernière (reviewedAt, sinon createdAt) — TOUS statuts (anti-ratchet : borne la FRÉQUENCE
      // là où le cap 10 % borne l'amplitude). Garde SERVICE (course à faible enjeu, tout reste
      // gaté médecin) ; médecin/infirmier NON concernés. Canal non urgent (jamais auto-appliqué).
      const lastResolved = await prisma.adjustmentProposal.findFirst({
        where: {
          patientId,
          parameterType,
          status: { not: "pending" },
          timeSlotStartHour: slot.timeSlotStartHour,
          carbRatioSlotStart: slot.carbRatioSlotStart,
          pumpBasalSlotId: slot.pumpBasalSlotId,
          moment: slot.moment, // US-2652 : cooldown PAR MOMENT (sinon morning bloque evening)
          basalDoseKind: slot.basalDoseKind, // US-2659 : cooldown PAR CIBLE stylo (sinon evening bloque morning en S2)
        },
        orderBy: { createdAt: "desc" },
        select: { reviewedAt: true, createdAt: true },
      })
      if (lastResolved) {
        const freedAt = (lastResolved.reviewedAt ?? lastResolved.createdAt).getTime()
        if (Date.now() - freedAt < INSULIN_BOUNDS.PATIENT_PROPOSAL_COOLDOWN_HOURS * 3_600_000) {
          throw new Error("patientProposalCooldown")
        }
      }
    }

    // 4. Anti-spam — pré-check (chemin rapide). L'unicité RÉELLE (course TOCTOU) est
    //    garantie par l'index unique partiel `adjustment_proposals_one_pending_per_slot`
    //    (`WHERE status='pending'`, migration 20260705100000) → P2002 ci-dessous.
    const existing = await prisma.adjustmentProposal.findFirst({
      where: {
        patientId,
        parameterType,
        status: "pending",
        timeSlotStartHour: slot.timeSlotStartHour,
        carbRatioSlotStart: slot.carbRatioSlotStart,
        pumpBasalSlotId: slot.pumpBasalSlotId,
        moment: slot.moment, // US-2652 : 1 pending PAR MOMENT (aligne le pré-check sur l'index partiel)
        basalDoseKind: slot.basalDoseKind, // US-2659 : 1 pending PAR CIBLE stylo (aligne sur l'index partiel)
      },
      select: { id: true },
    })
    if (existing) throw new Error("duplicatePendingProposal")

    // 5. Création — provenance DÉRIVÉE serveur ; métriques moteur nulles ; jamais appliqué.
    //    ⚠️ La primitive fait confiance à `proposer` ; la ROUTE appelante (US-2648/2650) DOIT
    //    imposer : (1) `canAccessPatient(user, patientId)` ; (2) un patient ne propose que sur
    //    SON dossier (session.patientId === patientId) ; (3) `proposer.role` mappé depuis le
    //    rôle de SESSION (jamais du body ; rejeter ADMIN/VIEWER) ; (4) politique `proposerComment`
    //    (le renvoyer/pas dans le DTO — c'est du ciphertext, à ne pas exposer au client).
    try {
      const created = await prisma.$transaction(async (tx) => {
        const proposal = await tx.adjustmentProposal.create({
          data: {
            patientId,
            parameterType,
            currentValue,
            proposedValue,
            changePercent,
            reason: input.reason,
            source: proposer.role,
            proposedByUserId: proposer.userId,
            proposerComment: input.proposerComment != null ? encryptField(input.proposerComment) : null,
            confidence: null,
            supportingEvents: null,
            status: "pending",
            sickDayAcknowledgedAt: sickDayAckAt, // US-2659 S3 — consentement DKA (timestamp immuable), null sinon
            ...slot,
          },
        })

        // Audit SANS PHI : provenance + pivot patient, jamais la valeur de dose. Pour une BAISSE basale patient
        // (acte à risque), enrichi (E3) : direction/mode/accusé DKA/maturité — catégories non-dose, forensic-ready.
        // US-2663 (S2b) — exclusion mutuelle : supersède le groupé pending du même paramètre (helper partagé).
        const supersededGroupedCount = await supersedeGroupedPending(tx, patientId, parameterType, proposer.role)

        await auditService.logWithTx(tx, {
          userId: proposer.userId,
          action: "CREATE",
          resource: "ADJUSTMENT_PROPOSAL",
          resourceId: proposal.id,
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          metadata: { patientId, proposedByRole: proposer.role, supersededGroupedCount, ...(decreaseAudit ?? {}) },
        })

        return proposal
      })

      // US-2649b — notifier le médecin RÉFÉRENT qu'une proposition est à revoir.
      // FIRE-AND-FORGET : hors transaction ET hors chemin de réponse (le serveur est
      // persistant, le `.catch` s'exécute) — la 201 ne dépend pas de FCM (retries jusqu'à
      // ~3 s si dégradé). L'échec (y compris la résolution du référent) est LOGUÉ, pas avalé.
      void notifyReviewers(patientId, created, ctx).catch((err) =>
        logger.error("adjustment", "notifyReviewers failed", { patientId }, err),
      )

      return created
    } catch (e) {
      // Course TOCTOU rattrapée par l'index partiel `adjustment_proposals_one_pending_per_slot`.
      // `isUniqueViolationOn` lit la forme Prisma 7 + adapter-pg (`meta.driverAdapterError.cause` ;
      // `meta.target` est undefined) — cf. src/lib/db/prisma-errors.ts. Ne re-mappe QUE cette contrainte.
      if (isUniqueViolationOn(e, "one_pending")) throw new Error("duplicatePendingProposal")
      throw e
    }
  },

  /**
   * US-2651 — Créer une proposition MOTEUR (générateur nocturne). Distinct de `createProposal`
   * (humain) : `source = algorithm`, `proposedByUserId = null`, métriques moteur NON nulles
   * (contrainte CHECK). Reprend les mêmes garde-fous serveur : frontière **nonInsulin** (MDR),
   * **bornes dures**, `currentValue` **re-dérivé serveur** (le candidat a été calculé sur un
   * snapshot — on re-vérifie contre la config LIVE) et recompute `changePercent`, **anti-spam**
   * (index `one_pending_per_slot`). Jamais appliqué (`pending`). Notifie le référent (best-effort).
   *
   * @param input Candidat + discriminateurs de créneau (fournis par le générateur selon le slot analysé).
   * @param ctx Contexte requête (audit).
   * @returns La proposition créée.
   */
  async createEngineProposal(input: CreateEngineProposalInput, ctx?: AuditContext) {
    const { patientId, parameterType, proposedValue } = input

    // 0. Frontière MDR : jamais de proposition de dose pour un patient non insuliné.
    const { mode } = await treatmentModeService.resolveTreatmentMode(patientId)
    if (mode === "nonInsulin") throw new Error("nonInsulinNoDose")

    // 1. Bornes cliniques dures + métriques moteur valides. `basalDoseKind` route les bornes basale
    //    STYLO (U totales) vs POMPE (U/h) — US-2659.
    if (!validateProposedValue(parameterType, proposedValue, input.basalDoseKind)) throw new Error("valueOutOfBounds")
    if (!Number.isFinite(input.supportingEvents) || input.supportingEvents <= 0) {
      throw new Error("invalidSupportingEvents") // une proposition à 0 événement n'a aucun sens
    }

    // 2. `currentValue` re-dérivé SERVEUR (jamais celui du candidat) + `changePercent` recalculé
    //    (borné ± 999,99 pour la colonne Decimal(5,2)). Réutilise les helpers de `createProposal`.
    const asInput: CreateProposalInput = {
      patientId,
      parameterType,
      proposedValue,
      reason: input.reason,
      timeSlotStartHour: input.timeSlotStartHour,
      timeSlotEndHour: input.timeSlotEndHour,
      carbRatioSlotStart: input.carbRatioSlotStart,
      carbRatioSlotEnd: input.carbRatioSlotEnd,
      pumpBasalSlotId: input.pumpBasalSlotId,
      moment: input.moment, // US-2652 : sans ça, `resolveCurrentValue` lève slotRequired → moteur fixedDose mort
      basalDoseKind: input.basalDoseKind, // US-2659 : sans ça, resolveCurrentValue lit la pompe → basale stylo morte
    }
    const currentValue = await resolveCurrentValue(patientId, parameterType, asInput)

    // 2b. COMPARE-AND-SWAP de persistance (US-2651, validé medical) : le candidat a été calculé sur
    //     `expectedCurrentValue` (snapshot). Si la config a DÉRIVÉ depuis l'analyse (médecin qui édite,
    //     autre proposition acceptée), on REJETTE plutôt que de persister une magnitude hors-cap OU un
    //     sens inversé (le `baselineMoved` de l'accept ne couvre que persist→accept). Le générateur
    //     re-analysera sur la nouvelle base au prochain run. Tolérance : bruit float sous la résolution
    //     Decimal(4). Rejeter, pas re-clamper (le re-clamp rebaserait une analyse périmée).
    if (Math.abs(currentValue - input.expectedCurrentValue) > 1e-9) {
      throw new Error("baselineMovedAtPersist")
    }

    const rawPct = currentValue !== 0 ? ((proposedValue - currentValue) / currentValue) * 100 : 0
    const changePercent = Math.max(-999.99, Math.min(999.99, rawPct))

    // 2c. Cohérence `reason` ↔ direction (défense en profondeur : garde aussi un candidat mal formé).
    //     `*TooLow` doit HAUSSER, `*TooHigh` doit BAISSER — sinon l'explication affichée serait fausse.
    const wantsIncrease = reasonImpliesIncrease(input.reason)
    if (wantsIncrease !== null) {
      const delta = proposedValue - currentValue
      if (delta === 0 || delta > 0 !== wantsIncrease) throw new Error("reasonDirectionMismatch")
    }

    const slot = slotFieldsFor(parameterType, asInput)

    // 3. Anti-spam (pré-check + index partiel unique via P2002 ci-dessous). Pas de garde patient.
    //    NB : le pré-check est « 1 pending / (patient × basalDoseKind) » (index `one_pending_per_slot`). Pour la
    //    basale STYLO, un index PLUS strict « 1 pending stylo / patient toutes cibles » (`one_pending_stylo_basal`,
    //    US-2659 S2) s'ajoute EN BASE (défense en profondeur, course inter-run) — sa P2002 est aussi captée par
    //    `isUniqueViolationOn(e, "one_pending")` → `duplicatePendingProposal`.
    const existing = await prisma.adjustmentProposal.findFirst({
      where: {
        patientId,
        parameterType,
        status: "pending",
        timeSlotStartHour: slot.timeSlotStartHour,
        carbRatioSlotStart: slot.carbRatioSlotStart,
        pumpBasalSlotId: slot.pumpBasalSlotId,
        moment: slot.moment, // US-2652 : 1 pending PAR MOMENT (aligne le pré-check sur l'index partiel)
        basalDoseKind: slot.basalDoseKind, // US-2659 : 1 pending PAR CIBLE stylo (aligne sur l'index partiel)
      },
      select: { id: true },
    })
    if (existing) throw new Error("duplicatePendingProposal")

    try {
      const created = await prisma.$transaction(async (tx) => {
        const proposal = await tx.adjustmentProposal.create({
          data: {
            patientId,
            parameterType,
            currentValue,
            proposedValue,
            changePercent,
            reason: input.reason,
            source: "algorithm",
            proposedByUserId: null,
            confidence: input.confidence,
            supportingEvents: input.supportingEvents,
            totalEventsConsidered: input.totalEventsConsidered ?? null,
            averageObservedValue: input.averageObservedValue ?? null,
            analysisPeriod: input.analysisPeriod ?? null,
            dataQuality: input.dataQuality ?? null,
            status: "pending",
            ...slot,
          },
        })
        // US-2663 (S2b) — exclusion mutuelle (moteur, symétrie confirmée medical) : supersède le groupé pending.
        const supersededGroupedCount = await supersedeGroupedPending(tx, patientId, parameterType, "algorithm")

        // Audit SANS PHI : provenance moteur + pivot patient, jamais la valeur de dose.
        await auditService.logWithTx(tx, {
          userId: null,
          action: "CREATE",
          resource: "ADJUSTMENT_PROPOSAL",
          resourceId: proposal.id,
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          metadata: { patientId, proposedByRole: "algorithm", supersededGroupedCount },
        })
        return proposal
      })

      void notifyReviewers(patientId, created, ctx).catch((err) =>
        logger.error("adjustment", "notifyReviewers failed", { patientId }, err),
      )
      return created
    } catch (e) {
      // Idem createProposal : forme d'erreur Prisma 7 + adapter-pg via `isUniqueViolationOn`.
      if (isUniqueViolationOn(e, "one_pending")) throw new Error("duplicatePendingProposal")
      throw e
    }
  },

  /**
   * Accept a proposal — optionally apply the change (DOCTOR-validated, ADR #13).
   *
   * Quand `applyImmediately`, écrit la valeur ABSOLUE `proposedValue` sur le créneau ciblé,
   * scopé patient (anti-IDOR) et dans la transaction (atomique avec le passage `accepted`) :
   * ISF (`timeSlotStartHour`), ICR (`carbRatioSlotStart`), basale POMPE (`pumpBasalSlotId`, U/h),
   * dose fixe (`moment`) ou — US-2660 — basale STYLO (`basalDoseKind` → `dailyDose`/`morningDose`/
   * `eveningDose`, U totales, sur l'unique `BasalConfiguration` du patient).
   *
   * Gardes fail-closed (rollback, jamais d'« accepté + appliqué » fantôme) :
   * - `baselineMoved` (compare-and-swap explicite) si la valeur live a dérivé depuis la proposition ;
   * - CAS atomique DB : chaque `updateMany` verrouille la valeur attendue (`<colonne>: currentValue`)
   *   dans son `WHERE` → une base déplacée dans la fenêtre TOCTOU, ou une dose stylo effacée, matche
   *   0 ligne → `…SlotNotFound` / `styloBasalNotFound` (rollback) ;
   * - `basalTargetAmbiguous` si un `basalRate` porte les DEUX discriminateurs (invariant, inatteignable
   *   sous le CHECK base — filet en profondeur) ;
   * - `noApplicableApplyTarget` si `applyImmediately` est demandé sans cible résoluble (fantôme évité).
   *
   * @param proposalId    id de la proposition `pending`
   * @param reviewerId    id du DOCTOR relecteur (tracé dans `reviewedBy` + audit)
   * @param applyImmediately  applique la valeur au créneau (sinon accepte le statut sans écriture)
   * @param ctx           contexte d'audit (ip/userAgent)
   * @returns `{ accepted, applied, patientId }`
   * @throws `proposalNotFound` | `valueOutOfBounds` | `baselineMoved` | `…SlotNotFound` |
   *   `styloBasalNotFound` | `basalTargetAmbiguous` | `noApplicableApplyTarget`
   */
  async accept(
    proposalId: string,
    reviewerId: number,
    applyImmediately: boolean,
    ctx?: AuditContext,
  ) {
    return prisma.$transaction(async (tx) => {
      const proposal = await tx.adjustmentProposal.findUnique({ where: { id: proposalId } })
      if (!proposal || proposal.status !== "pending") {
        throw new Error("proposalNotFound")
      }

      await tx.adjustmentProposal.update({
        where: { id: proposalId },
        data: {
          status: "accepted",
          reviewedAt: new Date(),
          reviewedBy: reviewerId,
        },
      })

      // Apply the change if requested.
      if (applyImmediately) {
        const proposed = Number(proposal.proposedValue)

        // US-2660 (durcissement, medical INFO) — invariant d'exclusivité de la cible basale, vérifié
        // EN PREMIER (avant `validateProposedValue`, qui routerait « à l'aveugle » les bornes via
        // `basalDoseKind` alors que la cible réelle est ambiguë). Le CHECK base
        // `adjustment_proposals_basal_target_exclusivity_check` (migration 20260719100000) impose déjà
        // un XOR `pumpBasalSlotId ⊕ basalDoseKind` pour `basalRate` (donc ce garde est INATTEIGNABLE
        // aujourd'hui). Filet en profondeur : si une future migration affaiblissait le CHECK, l'ordre
        // `pompe (U/h) avant stylo (U totales)` du if-chain lirait la baseline stylo tout en écrivant le
        // débit pompe (catastrophique). Fail-closed AVANT toute écriture ni tout routage de bornes.
        if (proposal.parameterType === "basalRate" && proposal.pumpBasalSlotId && proposal.basalDoseKind != null) {
          throw new Error("basalTargetAmbiguous")
        }

        // Validation des bornes cliniques dures (fail-closed avant écriture).
        if (!validateProposedValue(proposal.parameterType, proposed, proposal.basalDoseKind)) {
          throw new Error("valueOutOfBounds")
        }

        // US-2649b / US-2660 — COMPARE-AND-SWAP (garde d'accès concurrent). `proposedValue` est une
        // valeur ABSOLUE calculée sur la base `currentValue` (snapshot de création). Si le créneau a
        // bougé depuis (édition médecin, autre proposition acceptée), l'appliquer sur-corrige (ex.
        // base descendue à 0.7 pour une hypo, proposition absolue 1.2 → +71 %). DEUX couches :
        //   1. Check EXPLICITE ci-dessous → `baselineMoved` (409 dédié, régénérer sur la vraie base) ;
        //      couvre la dérive détectable AVANT écriture. `null` (créneau disparu) laissé aux gardes
        //      d'apply (…SlotNotFound).
        //   2. Égalité `<colonne>: proposal.currentValue` DANS le `WHERE` de chaque `updateMany`
        //      (US-2660) → CAS ATOMIQUE côté DB. `liveCurrentValue` lit hors transaction (client global,
        //      pas `tx`) : une écriture concurrente peut se glisser ENTRE ce check et l'`updateMany`
        //      (TOCTOU). En verrouillant la valeur attendue dans le `WHERE`, une base déplacée dans
        //      cette fenêtre → 0 ligne → …SlotNotFound (rollback), jamais l'écrasement silencieux d'un
        //      changement concurrent. `proposal.currentValue` (Prisma Decimal) est passé tel quel :
        //      comparaison numérique Postgres exacte, sans imprécision flottante. Ce verrou subsume
        //      aussi le cas « dose stylo effacée » (NULL ≠ valeur → 0 ligne → styloBasalNotFound).
        const liveBase = await adjustmentService.liveCurrentValue(proposal.patientId, proposal)
        if (liveBase !== null && liveBase !== Number(proposal.currentValue)) {
          throw new Error("baselineMoved")
        }
        // INVARIANT (verrouillé par tests/unit/cas-decimal-scale-invariant.test.ts) : `currentValue`
        // est `Decimal(8,4)` (scale 4) et TOUTES les colonnes de dose cibles ont une scale ≤ 4 (ISF 4,
        // pompe 3, ICR/dose fixe/stylo 2). Le round-trip `colonne → currentValue` à la création est donc
        // SANS troncature, et l'égalité CAS `<colonne>: casValue` matche exactement une base inchangée.
        // ⚠️ Si une future migration portait une colonne de dose à une scale > 4, `currentValue`
        // tronquerait → faux fail-closed sur un apply LÉGITIME (dégradation de disponibilité, jamais une
        // mauvaise dose). Le test de garde ci-dessus casse dans ce cas — ne pas contourner sans revoir ce CAS.
        const casValue = proposal.currentValue // Prisma Decimal — verrou CAS dans le WHERE

        if (proposal.parameterType === "insulinSensitivityFactor" && proposal.timeSlotStartHour != null) {
          const res = await tx.insulinSensitivityFactor.updateMany({
            where: {
              settings: { patientId: proposal.patientId },
              startHour: proposal.timeSlotStartHour,
              sensitivityFactorGl: casValue,
            },
            data: {
              sensitivityFactorGl: proposed,
              sensitivityFactorMgdl: proposed * 100,
            },
          })
          // Fail-closed : si le créneau a disparu/bougé entre proposition et accept, ne pas
          // laisser un « accepté + appliqué » fantôme (le médecin croirait la valeur active).
          assertRowApplied(res.count, "isfSlotNotFound")
        } else if (proposal.parameterType === "insulinToCarbRatio" && proposal.carbRatioSlotStart != null) {
          const res = await tx.carbRatio.updateMany({
            where: {
              settings: { patientId: proposal.patientId },
              startHour: proposal.carbRatioSlotStart,
              gramsPerUnit: casValue,
            },
            data: { gramsPerUnit: proposed },
          })
          assertRowApplied(res.count, "icrSlotNotFound")
        } else if (proposal.parameterType === "basalRate" && proposal.pumpBasalSlotId) {
          // Re-scopé au patient de la proposition (défense en profondeur, anti-IDOR) :
          // un pumpBasalSlotId qui n'appartiendrait pas au patient ne matche pas → count 0
          // → fail-closed (créneau introuvable), jamais d'écriture cross-patient.
          const res = await tx.pumpBasalSlot.updateMany({
            where: {
              id: proposal.pumpBasalSlotId,
              basalConfig: { settings: { patientId: proposal.patientId } },
              rate: casValue,
            },
            data: { rate: proposed },
          })
          assertRowApplied(res.count, "pumpSlotNotFound")
        } else if (proposal.parameterType === "fixedDose" && proposal.moment != null) {
          // Dose fixe (US-2652) — scopée patient via la relation `patientInsulin` (anti-IDOR) : un
          // moment hors patient ne matche pas → count 0 → fail-closed (créneau introuvable).
          const res = await tx.fixedDoseSlot.updateMany({
            // US-2663 (S3d, revue) — filtre insuline ACTIVE : n'écrit jamais sur une insuline discontinuée.
            where: { patientInsulin: { patientId: proposal.patientId, ...activeInsulinFilter() }, moment: proposal.moment, valueU: casValue },
            data: { valueU: proposed },
          })
          // US-2663 (S3d) — fail-closed sur l'AMBIGUÏTÉ d'usage. Le modèle par-valeur ne porte PAS l'usage
          // (`moment` seul) : si deux `PatientInsulin` (ex. bolus rapide + basale lente) partagent ce moment ET
          // cette valeur, le `updateMany` toucherait PLUSIEURS lignes (count > 1) — écriture multiple silencieuse
          // sur la mauvaise insuline. On REFUSE désormais (avant : seul count 0 était gardé, count > 1 passait).
          // La voie GROUPÉE (S3d) résout par `(usage, moment)` et n'a pas cette ambiguïté. (À valider medical.)
          if (res.count === 0) throw new Error("fixedDoseSlotNotFound")
          if (res.count > 1) throw new Error("fixedDoseSlotAmbiguous")
        } else if (proposal.parameterType === "basalRate" && proposal.basalDoseKind != null) {
          // US-2660 — ÉCRITURE GROUPÉE de la basale STYLO (MDI). La dose ciblée par `basalDoseKind`
          // (`dailyDose`/`morningDose`/`eveningDose`, UNITÉS TOTALES) est écrite sur l'unique
          // `BasalConfiguration` du patient (contrainte `settingsId @unique` + `patientId @unique` →
          // 1 config/patient : le `updateMany` scopé patient touche au plus 1 ligne, cohérent avec la
          // lecture `resolveCurrentValue`). Scopé patient via `settings` (anti-IDOR). Le verrou CAS
          // `<colonne>: casValue` (cf. ci-dessus) subsume le fail-closed « dose effacée » (NULL ≠
          // valeur → 0 ligne → `styloBasalNotFound`, rollback — jamais de réintroduction silencieuse
          // d'une dose supprimée, ni d'« accepté + appliqué » fantôme).
          const column =
            proposal.basalDoseKind === "daily" ? "dailyDose"
            : proposal.basalDoseKind === "morning" ? "morningDose"
            : "eveningDose"
          const res = await tx.basalConfiguration.updateMany({
            where: {
              settings: { patientId: proposal.patientId },
              [column]: casValue,
            },
            data: { [column]: proposed },
          })
          assertRowApplied(res.count, "styloBasalNotFound")
        } else {
          // US-2660 (code-review MED) — filet fail-closed : `applyImmediately` demandé mais AUCUNE
          // cible résolue (couple parameterType×discriminateur inattendu — p.ex. proposition
          // `createManual` sans discriminateur de créneau, non gardée par `resolveCurrentValue`).
          // Sans ce garde, la fonction retournerait `applied: true` SANS écriture (fantôme). Rollback.
          throw new Error("noApplicableApplyTarget")
        }
      }

      await auditService.logWithTx(tx, {
        userId: reviewerId,
        action: "PROPOSAL_ACCEPTED",
        resource: "ADJUSTMENT_PROPOSAL",
        resourceId: proposalId,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        metadata: { applyImmediately, patientId: proposal.patientId },
      })

      return { accepted: true, applied: applyImmediately, patientId: proposal.patientId }
    })
  },

  /** Reject a proposal */
  async reject(proposalId: string, reviewerId: number, ctx?: AuditContext) {
    const result = await prisma.$transaction(async (tx) => {
      const proposal = await tx.adjustmentProposal.findUnique({ where: { id: proposalId } })
      if (!proposal || proposal.status !== "pending") {
        throw new Error("proposalNotFound")
      }

      await tx.adjustmentProposal.update({
        where: { id: proposalId },
        data: {
          status: "rejected",
          reviewedAt: new Date(),
          reviewedBy: reviewerId,
        },
      })

      await auditService.logWithTx(tx, {
        userId: reviewerId,
        action: "PROPOSAL_REJECTED",
        resource: "ADJUSTMENT_PROPOSAL",
        resourceId: proposalId,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
      })

      return { rejected: true, patientId: proposal.patientId }
    })

    return result
  },

  async notifyPatient(patientId: number, senderId: number, action: "accepted" | "rejected", ctx?: AuditContext): Promise<{ notified: boolean }> {
    // BEST-EFFORT, JAMAIS bloquant : cette notification est appelée APRÈS le commit de l'accept/reject
    // (proposition déjà appliquée). Toute défaillance — y compris un aléa DB sur le `findFirst` — doit
    // renvoyer `{ notified: false }`, jamais throw (sinon la route renverrait 500 sur un acte déjà réussi,
    // induisant un retry inutile). Le `try` englobe donc TOUTE la méthode (revue code-reviewer S1, US-2663).
    const titles: Record<string, string> = {
      accepted: "Proposition acceptée",
      rejected: "Proposition refusée",
    }
    const bodies: Record<string, string> = {
      accepted: "Votre médecin a accepté une proposition d'ajustement de traitement.",
      rejected: "Votre médecin a refusé une proposition d'ajustement.",
    }

    try {
      const patient = await prisma.patient.findFirst({
        where: { id: patientId, deletedAt: null },
        select: { userId: true },
      })
      if (!patient) return { notified: false }

      const result = await fcmService.sendToUser({
        userId: patient.userId,
        senderId,
        title: titles[action],
        body: bodies[action],
        data: { type: "proposal_update", action },
      }, ctx)
      return { notified: result.sent > 0 }
    } catch (err) {
      logger.error("adjustment", "Push notification failed", { patientId }, err)
      return { notified: false }
    }
  },
}
