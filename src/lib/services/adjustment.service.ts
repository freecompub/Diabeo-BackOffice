/**
 * @module adjustment.service
 * @description Adjustment proposals — suggestions for ISF/ICR/basal changes based on data analysis.
 * Proposals are immutable once created and require doctor review (DOCTOR-only accept/reject).
 * Clinical bounds enforced before application.
 * @see CLAUDE.md#adjustment-proposals — Proposal workflow and clinical bounds
 */

import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import { fcmService } from "./fcm.service"
import { logger } from "@/lib/logger"
import { INSULIN_BOUNDS } from "./insulin-therapy.service"
import { isDeliverableBasalRate } from "@/lib/clinical-bounds"
import { encryptField } from "@/lib/crypto/fields"
import type { AuditContext } from "./patient.service"
import type {
  ProposalStatus, Prisma, AdjustableParameter, AdjustmentReason, ProposalSource,
} from "@prisma/client"

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
 * @throws `slotRequired` (créneau manquant), `currentValueNotFound` (créneau absent /
 *   autre patient), `fixedDoseNotWired` (dose fixe non câblée — pas de discriminateur
 *   de moment sur AdjustmentProposal, cf. US-2648/2649b).
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
    // Dose fixe : AdjustmentProposal n'a pas de colonne « moment » → impossible de cibler
    // /dédupliquer une FixedDoseSlot. Fail-closed jusqu'au câblage UI + discriminateur.
    case "fixedDose":
      throw new Error("fixedDoseNotWired")
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
  }
  switch (parameterType) {
    case "insulinSensitivityFactor":
      return { ...empty, timeSlotStartHour: input.timeSlotStartHour ?? null, timeSlotEndHour: input.timeSlotEndHour ?? null }
    case "insulinToCarbRatio":
      return { ...empty, carbRatioSlotStart: input.carbRatioSlotStart ?? null, carbRatioSlotEnd: input.carbRatioSlotEnd ?? null }
    case "basalRate":
      return { ...empty, pumpBasalSlotId: input.pumpBasalSlotId ?? null }
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
   * disparu/bougé (ISF/ICR par heure, basal par id) ou n'est pas résoluble → l'UI n'affiche
   * alors pas de comparaison. Réutilise la lecture scopée patient de `resolveCurrentValue`.
   */
  async liveCurrentValue(
    patientId: number,
    proposal: {
      parameterType: AdjustableParameter
      timeSlotStartHour: number | null
      carbRatioSlotStart: number | null
      pumpBasalSlotId: string | null
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
      })
    } catch (err) {
      // Cas ATTENDUS (créneau absent/non résoluble) → null silencieux. Une erreur INATTENDUE
      // (panne DB, etc.) est loguée : sans ça, un échec de lecture masquerait l'avertissement
      // « config modifiée » sans trace (observabilité).
      const expected =
        err instanceof Error &&
        ["slotRequired", "currentValueNotFound", "fixedDoseNotWired"].includes(err.message)
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
      // basalRate : jamais de BAISSE (risque hyper/cétose silencieuse). NB : on N'applique
      // PAS « no-decrease » à ISF/ICR — MONTER l'ISF/ICR RÉDUIT la dose (direction plus sûre) ;
      // les deux sens y sont seulement bornés en amplitude (raffinement min/abs → US-2652).
      if (parameterType === "basalRate" && delta < 0) {
        throw new Error("patientDecreaseForbidden")
      }
      if (Math.abs(changePercent) > INSULIN_BOUNDS.PATIENT_MAX_CHANGE_PERCENT) {
        throw new Error("patientDeltaTooLarge")
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
      // On ne re-mappe QUE cette contrainte-là (pas n'importe quel P2002) pour ne pas masquer
      // un futur conflit d'unicité sans rapport.
      const err = e as { code?: string; meta?: { target?: unknown } }
      const target = Array.isArray(err.meta?.target) ? err.meta!.target.join(",") : String(err.meta?.target ?? "")
      if (err.code === "P2002" && target.includes("one_pending")) {
        throw new Error("duplicatePendingProposal")
      }
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

        // US-2646 — l'écriture d'une dose fixe (fixed_dose_slots) est câblée en
        // US-2647/2649. Tant qu'elle ne l'est pas, on REFUSE l'application immédiate
        // (fail-closed) plutôt que de renvoyer un faux `applied: true` sur un no-op.
        if (proposal.parameterType === "fixedDose") {
          throw new Error("fixedDoseApplyNotImplemented")
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
