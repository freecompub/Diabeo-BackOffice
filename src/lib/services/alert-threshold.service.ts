/**
 * @module alert-threshold.service
 * @description US-2215 — Per-patient configuration of alert emission rules.
 *
 * Backed by AlertThresholdConfig. Defaults come from ADA-aligned CGM thresholds
 * stored in CgmObjective. This service governs *when* an alert is emitted
 * (which severity levels, cooldown), not the threshold values themselves.
 */

import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import type { AuditContext } from "./patient.service"

export const ALERT_THRESHOLD_DEFAULTS = {
  alertOnHypo: true,
  alertOnSevereHypo: true,
  alertOnHyper: false,
  alertOnSevereHyper: true,
  notifyDoctorPush: true,
  notifyDoctorEmail: true,
  cooldownMinutes: 30,
} as const

export const COOLDOWN_BOUNDS = {
  MIN: 5,
  MAX: 1440,
} as const

interface AlertThresholdInput {
  alertOnHypo?: boolean
  alertOnSevereHypo?: boolean
  alertOnHyper?: boolean
  alertOnSevereHyper?: boolean
  notifyDoctorPush?: boolean
  notifyDoctorEmail?: boolean
  cooldownMinutes?: number
}

export const alertThresholdService = {
  async get(patientId: number, auditUserId: number, ctx?: AuditContext) {
    const [record, patient] = await Promise.all([
      prisma.alertThresholdConfig.findUnique({ where: { patientId } }),
      prisma.patient.findFirst({
        where: { id: patientId, deletedAt: null },
        select: { id: true },
      }),
    ])

    if (!patient) return null

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "PATIENT",
      resourceId: `${patientId}:alert-thresholds`,
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
    })

    return record ?? { patientId, ...ALERT_THRESHOLD_DEFAULTS }
  },

  async upsert(
    patientId: number,
    input: AlertThresholdInput,
    auditUserId: number,
    ctx?: AuditContext,
  ) {
    if (input.cooldownMinutes !== undefined) {
      if (
        input.cooldownMinutes < COOLDOWN_BOUNDS.MIN ||
        input.cooldownMinutes > COOLDOWN_BOUNDS.MAX
      ) {
        throw new Error("cooldown_out_of_bounds")
      }
    }

    return prisma.$transaction(async (tx) => {
      const updated = await tx.alertThresholdConfig.upsert({
        where: { patientId },
        update: input,
        create: { patientId, ...ALERT_THRESHOLD_DEFAULTS, ...input },
      })

      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "UPDATE",
        resource: "PATIENT",
        resourceId: `${patientId}:alert-thresholds`,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
      })

      return updated
    })
  },
}
