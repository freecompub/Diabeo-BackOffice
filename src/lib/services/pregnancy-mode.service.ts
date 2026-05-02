/**
 * @module pregnancy-mode.service
 * @description US-2232 — Toggle pregnancy mode and auto-adapt CGM thresholds.
 *
 * Pregnancy mode tightens CGM thresholds per ADA/ACOG guidelines (gestational
 * diabetes targets are stricter to protect the fetus). Toggling ON copies the
 * GD defaults into CgmObjective; toggling OFF restores ADA standard defaults.
 *
 * The toggle is independent from PatientPregnancy.active (which records the
 * actual pregnancy) — clinicians can flip the mode quickly, then complete the
 * pregnancy record later. Email/push notifications are a doctor decision and
 * are not triggered by this toggle.
 *
 * **Safety guard (clinical)**: toggling OFF while PatientPregnancy.active
 * is true is rejected unless the caller passes `forceOverride: true`. Loosening
 * thresholds during a confirmed pregnancy is a fetal-risk regression.
 */

import { prisma } from "@/lib/db/client"
import { getCgmDefaults } from "./objectives.service"
import { auditService } from "./audit.service"
import type { AuditContext } from "./patient.service"

interface SetModeOptions {
  /** Bypass the active-pregnancy guard when disabling. Audit-tagged. */
  forceOverride?: boolean
}

export const pregnancyModeService = {
  async setMode(
    patientId: number,
    enabled: boolean,
    auditUserId: number,
    ctx?: AuditContext,
    options?: SetModeOptions,
  ) {
    const patient = await prisma.patient.findFirst({
      where: { id: patientId, deletedAt: null },
      select: { id: true, pregnancyMode: true, pathology: true },
    })
    if (!patient) throw new Error("patient_not_found")

    if (patient.pregnancyMode === enabled) {
      return { patientId, pregnancyMode: enabled, thresholdsAdapted: false }
    }

    // Safety: do not silently widen thresholds during an active pregnancy.
    if (!enabled && !options?.forceOverride) {
      const activePregnancy = await prisma.patientPregnancy.findFirst({
        where: { patientId, active: true },
        select: { id: true },
      })
      if (activePregnancy) {
        throw new Error("active_pregnancy_blocks_toggle_off")
      }
    }

    return prisma.$transaction(async (tx) => {
      await tx.patient.update({
        where: { id: patientId },
        data: { pregnancyMode: enabled },
      })

      const defaults = getCgmDefaults(
        enabled || patient.pathology === "GD" ? "GD" : patient.pathology,
      )

      const cgmData = {
        veryLow: defaults.veryLow,
        low: defaults.low,
        ok: defaults.ok,
        high: defaults.high,
        titrLow: defaults.titrLow,
        titrHigh: defaults.titrHigh,
      }

      await tx.cgmObjective.upsert({
        where: { patientId },
        update: cgmData,
        create: { patientId, ...cgmData },
      })

      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "UPDATE",
        resource: "PATIENT",
        resourceId: `${patientId}:pregnancy-mode`,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        oldValue: { pregnancyMode: patient.pregnancyMode },
        newValue: { pregnancyMode: enabled },
        metadata: {
          thresholdsAdapted: true,
          ...(options?.forceOverride && { forceOverride: true }),
        },
      })

      return { patientId, pregnancyMode: enabled, thresholdsAdapted: true }
    })
  },
}
