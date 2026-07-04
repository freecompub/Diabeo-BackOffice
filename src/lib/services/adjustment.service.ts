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
  currentValue: number
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
function validateProposedValue(parameterType: string, value: number): boolean {
  switch (parameterType) {
    case "insulinSensitivityFactor":
      return value >= INSULIN_BOUNDS.ISF_GL_MIN && value <= INSULIN_BOUNDS.ISF_GL_MAX
    case "insulinToCarbRatio":
      return value >= INSULIN_BOUNDS.ICR_MIN && value <= INSULIN_BOUNDS.ICR_MAX
    case "basalRate":
      return value >= INSULIN_BOUNDS.BASAL_MIN && value <= INSULIN_BOUNDS.BASAL_MAX
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
 * Adjustment proposal service — CRUD and review workflow.
 * @namespace adjustmentService
 */
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
    const { patientId, parameterType, currentValue, proposedValue } = input

    // 1. Bornes cliniques dures — rejet à la création.
    if (!validateProposedValue(parameterType, proposedValue)) {
      throw new Error("valueOutOfBounds")
    }

    const delta = proposedValue - currentValue
    const changePercent = currentValue !== 0 ? (delta / currentValue) * 100 : 0

    // 2. Garde-fous PATIENT (une demande, pas une titration).
    if (proposer.role === "patient") {
      if ((parameterType === "basalRate" || parameterType === "fixedDose") && delta < 0) {
        throw new Error("patientDecreaseForbidden")
      }
      const overCap =
        parameterType === "fixedDose"
          ? Math.abs(delta) > INSULIN_BOUNDS.FIXED_DOSE_PATIENT_MAX_DELTA_U
          : Math.abs(changePercent) > INSULIN_BOUNDS.PATIENT_MAX_CHANGE_PERCENT
      if (overCap) throw new Error("patientDeltaTooLarge")
    }

    // 3. Anti-spam : une seule proposition PENDING par (patient, paramètre, créneau).
    const existing = await prisma.adjustmentProposal.findFirst({
      where: {
        patientId,
        parameterType,
        status: "pending",
        timeSlotStartHour: input.timeSlotStartHour ?? null,
        carbRatioSlotStart: input.carbRatioSlotStart ?? null,
        pumpBasalSlotId: input.pumpBasalSlotId ?? null,
      },
      select: { id: true },
    })
    if (existing) throw new Error("duplicatePendingProposal")

    // 4. Création — provenance DÉRIVÉE serveur ; jamais appliqué.
    return prisma.$transaction(async (tx) => {
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
          timeSlotStartHour: input.timeSlotStartHour ?? null,
          timeSlotEndHour: input.timeSlotEndHour ?? null,
          carbRatioSlotStart: input.carbRatioSlotStart ?? null,
          carbRatioSlotEnd: input.carbRatioSlotEnd ?? null,
          pumpBasalSlotId: input.pumpBasalSlotId ?? null,
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

        if (proposal.parameterType === "insulinSensitivityFactor" && proposal.timeSlotStartHour != null) {
          await tx.insulinSensitivityFactor.updateMany({
            where: {
              settings: { patientId: proposal.patientId },
              startHour: proposal.timeSlotStartHour,
            },
            data: {
              sensitivityFactorGl: proposed,
              sensitivityFactorMgdl: proposed * 100,
            },
          })
        } else if (proposal.parameterType === "insulinToCarbRatio" && proposal.carbRatioSlotStart != null) {
          await tx.carbRatio.updateMany({
            where: {
              settings: { patientId: proposal.patientId },
              startHour: proposal.carbRatioSlotStart,
            },
            data: { gramsPerUnit: proposed },
          })
        } else if (proposal.parameterType === "basalRate" && proposal.pumpBasalSlotId) {
          await tx.pumpBasalSlot.update({
            where: { id: proposal.pumpBasalSlotId },
            data: { rate: proposed },
          })
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
