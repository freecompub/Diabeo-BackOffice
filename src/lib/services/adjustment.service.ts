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
import { isDeliverableBasalRate } from "@/lib/clinical-bounds"
import { checkPatientChangeCap, patientCapType } from "@/lib/insulin/patient-change-cap"
import { encryptField } from "@/lib/crypto/fields"
import type { AuditContext } from "./patient.service"
import type {
  ProposalStatus, Prisma, AdjustableParameter, AdjustmentReason, ProposalSource, ConfidenceLevel, DoseMoment,
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
 */
function reasonImpliesIncrease(reason: AdjustmentReason): boolean | null {
  if (reason.endsWith("TooLow")) return true
  if (reason.endsWith("TooHigh")) return false
  return null
}

function validateProposedValue(parameterType: string, value: number): boolean {
  switch (parameterType) {
    case "insulinSensitivityFactor":
      return value >= INSULIN_BOUNDS.ISF_GL_MIN && value <= INSULIN_BOUNDS.ISF_GL_MAX
    case "insulinToCarbRatio":
      return value >= INSULIN_BOUNDS.ICR_MIN && value <= INSULIN_BOUNDS.ICR_MAX
    // US-2648b — un débit basal doit être PROGRAMMABLE sur la pompe : multiple de
    // `PUMP_BASAL_INCREMENT` (0,05 U/h). Sinon la valeur passe les bornes mais n'est pas
    // délivrable (arrondi silencieux / profil rejeté à l'application). Rejet à la création.
    case "basalRate":
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
        where: { patientInsulin: { patientId }, moment: input.moment },
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
 * US-2652 — `kind` (basal/bolus) d'une dose fixe, résolu SERVEUR via `PatientInsulin.usage` du créneau
 * (`moment`), scopé patient. `both` (pré-mélangée) est mappé côté `patientCapType` → règle basale stricte.
 * @throws currentValueNotFound (moment absent / autre patient — cohérent avec `resolveCurrentValue`).
 */
async function resolveFixedDoseKind(patientId: number, moment: CreateProposalInput["moment"]): Promise<"basal" | "bolus" | "both"> {
  if (!moment) throw new Error("slotRequired")
  const row = await prisma.fixedDoseSlot.findFirst({
    where: { patientInsulin: { patientId }, moment },
    select: { patientInsulin: { select: { usage: true } } },
  })
  if (!row) throw new Error("currentValueNotFound")
  return row.patientInsulin.usage
}

/** US-2652 — Le patient est-il en mode PÉDIATRIQUE (ConfigVersion active) ? Résolu serveur (durcit les caps). */
async function isPatientPediatric(patientId: number): Promise<boolean> {
  const v = await prisma.configVersion.findFirst({
    where: { patientId, configType: "pediatric_mode", status: "active" },
    select: { id: true },
  })
  return v != null
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
  }
  switch (parameterType) {
    case "insulinSensitivityFactor":
      return { ...empty, timeSlotStartHour: input.timeSlotStartHour ?? null, timeSlotEndHour: input.timeSlotEndHour ?? null }
    case "insulinToCarbRatio":
      return { ...empty, carbRatioSlotStart: input.carbRatioSlotStart ?? null, carbRatioSlotEnd: input.carbRatioSlotEnd ?? null }
    case "basalRate":
      return { ...empty, pumpBasalSlotId: input.pumpBasalSlotId ?? null }
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
    },
    auditUserId: number,
    ctx?: AuditContext,
  ) {
    const where: Prisma.AdjustmentProposalWhereInput = { patientId }
    if (filters.status) where.status = filters.status
    if (filters.parameterType) where.parameterType = filters.parameterType as Prisma.EnumAdjustableParameterFilter
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

  /** Get summary counts by status */
  async summary(patientId: number) {
    const [pending, accepted, rejected, expired] = await Promise.all([
      prisma.adjustmentProposal.count({ where: { patientId, status: "pending" } }),
      prisma.adjustmentProposal.count({ where: { patientId, status: "accepted" } }),
      prisma.adjustmentProposal.count({ where: { patientId, status: "rejected" } }),
      prisma.adjustmentProposal.count({ where: { patientId, status: "expired" } }),
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

    return prisma.$transaction(async (tx) => {
      const proposal = await tx.adjustmentProposal.create({ data: input })

      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "CREATE",
        resource: "ADJUSTMENT_PROPOSAL",
        resourceId: proposal.id,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
      })

      return proposal
    })
  },

  /**
   * US-2649a — Créer une proposition d'ajustement **humaine** (patient / infirmier /
   * médecin) depuis une entrée structurée. Garde-fous imposés SERVEUR :
   *  - provenance dérivée du `proposer` authentifié (jamais du body) ;
   *  - bornes cliniques vérifiées **à la création** (pas seulement à l'accept) ;
   *  - pour un PATIENT : sens interdit (jamais de baisse de basale/dose fixe) + cap
   *    de variation resserré (dose fixe en U, ratios en %) ;
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
    const { mode } = await treatmentModeService.resolveTreatmentMode(patientId)
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

    // 1. Bornes cliniques dures — rejet à la création (pas seulement à l'accept).
    if (!validateProposedValue(parameterType, proposedValue)) {
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
    if (proposer.role === "patient") {
      // US-2652 — cap PAR TYPE `min(%, absolu)` (corrige le « % seul » aux extrêmes) + direction :
      //  - baisse INTERDITE pour la famille basale (pompe + dose fixe basale : risque hyper/cétose) ;
      //  - symétrique pour ISF/ICR et dose fixe BOLUS (une baisse de bolus pour hypo est légitime).
      // `kind` (dose fixe) et pédiatrie résolus SERVEUR (jamais du body). Voir `patient-change-cap.ts`.
      const fixedDoseKind = parameterType === "fixedDose" ? await resolveFixedDoseKind(patientId, input.moment) : undefined
      const isPediatric = parameterType === "fixedDose" ? await isPatientPediatric(patientId) : false
      const violation = checkPatientChangeCap(patientCapType(parameterType, fixedDoseKind), currentValue, proposedValue, isPediatric)
      if (violation) throw new Error(violation)

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
            ...slot,
          },
        })

        // Audit SANS PHI : provenance + pivot patient, jamais la valeur de dose.
        await auditService.logWithTx(tx, {
          userId: proposer.userId,
          action: "CREATE",
          resource: "ADJUSTMENT_PROPOSAL",
          resourceId: proposal.id,
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          metadata: { patientId, proposedByRole: proposer.role },
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

    // 1. Bornes cliniques dures + métriques moteur valides.
    if (!validateProposedValue(parameterType, proposedValue)) throw new Error("valueOutOfBounds")
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
    const existing = await prisma.adjustmentProposal.findFirst({
      where: {
        patientId,
        parameterType,
        status: "pending",
        timeSlotStartHour: slot.timeSlotStartHour,
        carbRatioSlotStart: slot.carbRatioSlotStart,
        pumpBasalSlotId: slot.pumpBasalSlotId,
        moment: slot.moment, // US-2652 : 1 pending PAR MOMENT (aligne le pré-check sur l'index partiel)
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
        // Audit SANS PHI : provenance moteur + pivot patient, jamais la valeur de dose.
        await auditService.logWithTx(tx, {
          userId: null,
          action: "CREATE",
          resource: "ADJUSTMENT_PROPOSAL",
          resourceId: proposal.id,
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          metadata: { patientId, proposedByRole: "algorithm" },
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

  /** Accept a proposal — optionally apply the change */
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

      // Apply the change if requested — validate bounds first
      if (applyImmediately) {
        const proposed = Number(proposal.proposedValue)

        if (!validateProposedValue(proposal.parameterType, proposed)) {
          throw new Error("valueOutOfBounds")
        }

        // US-2649b — COMPARE-AND-SWAP (garde d'accès concurrent). `proposedValue` est une
        // valeur ABSOLUE calculée sur la base `currentValue` (snapshot de création). Si le
        // créneau a bougé depuis (édition médecin, autre proposition acceptée), l'appliquer
        // sur-corrige (ex. base descendue à 0.7 pour une hypo, proposition absolue 1.2 → +71 %).
        // Fail-closed : on REFUSE et on invite à régénérer une proposition sur la vraie base.
        // `null` (créneau disparu) est laissé aux gardes d'apply ci-dessous (…SlotNotFound).
        const liveBase = await adjustmentService.liveCurrentValue(proposal.patientId, proposal)
        if (liveBase !== null && liveBase !== Number(proposal.currentValue)) {
          throw new Error("baselineMoved")
        }

        if (proposal.parameterType === "insulinSensitivityFactor" && proposal.timeSlotStartHour != null) {
          const res = await tx.insulinSensitivityFactor.updateMany({
            where: {
              settings: { patientId: proposal.patientId },
              startHour: proposal.timeSlotStartHour,
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
            },
            data: { rate: proposed },
          })
          assertRowApplied(res.count, "pumpSlotNotFound")
        } else if (proposal.parameterType === "fixedDose" && proposal.moment != null) {
          // Dose fixe (US-2652) — scopée patient via la relation `patientInsulin` (anti-IDOR) : un
          // moment hors patient ne matche pas → count 0 → fail-closed (créneau introuvable).
          const res = await tx.fixedDoseSlot.updateMany({
            where: { patientInsulin: { patientId: proposal.patientId }, moment: proposal.moment },
            data: { valueU: proposed },
          })
          assertRowApplied(res.count, "fixedDoseSlotNotFound")
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
    const patient = await prisma.patient.findFirst({
      where: { id: patientId, deletedAt: null },
      select: { userId: true },
    })
    if (!patient) return { notified: false }

    const titles: Record<string, string> = {
      accepted: "Proposition acceptée",
      rejected: "Proposition refusée",
    }
    const bodies: Record<string, string> = {
      accepted: "Votre médecin a accepté une proposition d'ajustement de traitement.",
      rejected: "Votre médecin a refusé une proposition d'ajustement.",
    }

    try {
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
