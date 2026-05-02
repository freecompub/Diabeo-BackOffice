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
import { encryptField } from "@/lib/crypto/fields"
import { getCgmDefaults } from "./objectives.service"
import { auditService } from "./audit.service"
import type { AuditContext } from "./patient.service"

interface SetModeOptions {
  /** Bypass the active-pregnancy guard when disabling. Audit-tagged. */
  forceOverride?: boolean
  /**
   * Required justification when forceOverride=true. Encrypted at rest in
   * audit metadata. Min 20 chars to force a real medical reason.
   */
  forceOverrideReason?: string
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

    // forceOverride requires a meaningful reason — pure boolean would let
    // a careless click loosen fetal-protection thresholds without trace.
    if (options?.forceOverride) {
      const reason = options.forceOverrideReason?.trim() ?? ""
      if (reason.length < 20) {
        throw new Error("force_override_reason_required")
      }
    }

    // Compute target defaults once, *outside* the transaction, so we know
    // up-front whether thresholds will actually change. A toggle-OFF on a
    // GD-pathology patient is a no-op for thresholds — audit must reflect this.
    const targetPathology =
      enabled || patient.pathology === "GD" ? "GD" : patient.pathology
    const defaults = getCgmDefaults(targetPathology)
    const currentCgm = await prisma.cgmObjective.findUnique({
      where: { patientId },
      select: {
        veryLow: true, low: true, ok: true, high: true,
        titrLow: true, titrHigh: true,
      },
    })
    const thresholdsActuallyChange =
      !currentCgm ||
      currentCgm.veryLow.toNumber() !== defaults.veryLow ||
      currentCgm.low.toNumber() !== defaults.low ||
      currentCgm.ok.toNumber() !== defaults.ok ||
      currentCgm.high.toNumber() !== defaults.high ||
      currentCgm.titrLow.toNumber() !== defaults.titrLow ||
      currentCgm.titrHigh.toNumber() !== defaults.titrHigh

    return prisma.$transaction(async (tx) => {
      await tx.patient.update({
        where: { id: patientId },
        data: { pregnancyMode: enabled },
      })

      if (thresholdsActuallyChange) {
        await tx.cgmObjective.upsert({
          where: { patientId },
          update: defaults,
          create: { patientId, ...defaults },
        })
      }

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
          thresholdsAdapted: thresholdsActuallyChange,
          pinnedTo: targetPathology,
          ...(options?.forceOverride && {
            forceOverride: true,
            // Encrypt the medical reason — PHI / clinical justification.
            forceOverrideReason: encryptField(
              options.forceOverrideReason!.trim(),
            ),
          }),
        },
      })

      return {
        patientId,
        pregnancyMode: enabled,
        thresholdsAdapted: thresholdsActuallyChange,
      }
    })
  },
}
