/**
 * @module ketone-threshold.service
 * @description US-2216 — Ketone thresholds per patient with clinical defaults.
 *
 * Clinical reference: ADA Diabetes Care 2024 — DKA prevention guidelines.
 *  - Light ketones (0.6–1.5 mmol/L)    → enhanced monitoring
 *  - Moderate ketones (1.5–3.0 mmol/L) → fast-acting insulin + carbs + hydration
 *  - DKA threshold (> 3.0 mmol/L)      → emergency, hospital protocol
 *
 * Storage layer for evaluation; alert emission lives in emergency.service.ts.
 * @see CLAUDE.md#audit-traceability — All reads/writes audited
 */

import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import type { AuditContext } from "./patient.service"

/**
 * Default ketone thresholds (mmol/L).
 * - Light: 0.6 mmol/L  → onset of detectable ketones (β-hydroxybutyrate).
 * - Moderate: 1.5 mmol/L → action required (insulin + carbs + hydration) per ISPAD/IDF.
 * - DKA: 3.0 mmol/L → impending DKA per ISPAD 2022 (≥ 3.0 is a DKA criterion).
 */
export const KETONE_DEFAULTS = {
  lightThreshold: 0.6,
  moderateThreshold: 1.5,
  dkaThreshold: 3.0,
  alertOnModerate: true,
  alertOnDka: true,
} as const

/**
 * Hard clinical bounds — refuse out-of-range values to protect patients.
 * Light < Moderate ≤ DKA, all > 0, all ≤ 10 mmol/L (physiological maximum).
 */
export const KETONE_BOUNDS = {
  MIN: 0.1,
  MAX: 10.0,
} as const

interface KetoneThresholdInput {
  lightThreshold?: number
  moderateThreshold?: number
  dkaThreshold?: number
  alertOnModerate?: boolean
  alertOnDka?: boolean
}

/**
 * Validate threshold ordering & clinical bounds.
 * Returns error message or null when valid.
 */
export function validateKetoneThresholds(input: {
  lightThreshold: number
  moderateThreshold: number
  dkaThreshold: number
}): string | null {
  const { lightThreshold, moderateThreshold, dkaThreshold } = input
  if (
    lightThreshold < KETONE_BOUNDS.MIN ||
    moderateThreshold < KETONE_BOUNDS.MIN ||
    dkaThreshold < KETONE_BOUNDS.MIN
  ) {
    return "ketone_threshold_below_min"
  }
  if (
    lightThreshold > KETONE_BOUNDS.MAX ||
    moderateThreshold > KETONE_BOUNDS.MAX ||
    dkaThreshold > KETONE_BOUNDS.MAX
  ) {
    return "ketone_threshold_above_max"
  }
  if (lightThreshold >= moderateThreshold) {
    return "light_must_be_less_than_moderate"
  }
  // Strict ordering aligns with ISPAD distinct moderate/severe bands and
  // prevents a degenerate config where a clinician sets moderate==dka and
  // then expects to "downgrade" by toggling alertOnDka — which the classifier
  // refuses (see emergency.service classifyKetoneAlert clinical safety note).
  if (moderateThreshold >= dkaThreshold) {
    return "moderate_must_be_less_than_dka"
  }
  return null
}

export const ketoneThresholdService = {
  async get(patientId: number, auditUserId: number, ctx?: AuditContext) {
    const [record, patient] = await Promise.all([
      prisma.ketoneThreshold.findUnique({ where: { patientId } }),
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
      resourceId: `${patientId}:ketone-thresholds`,
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
    })

    return record ?? { patientId, ...KETONE_DEFAULTS }
  },

  async upsert(
    patientId: number,
    input: KetoneThresholdInput,
    auditUserId: number,
    ctx?: AuditContext,
  ) {
    const merged = {
      lightThreshold: input.lightThreshold ?? KETONE_DEFAULTS.lightThreshold,
      moderateThreshold:
        input.moderateThreshold ?? KETONE_DEFAULTS.moderateThreshold,
      dkaThreshold: input.dkaThreshold ?? KETONE_DEFAULTS.dkaThreshold,
    }
    const error = validateKetoneThresholds(merged)
    if (error) {
      throw new Error(error)
    }

    return prisma.$transaction(async (tx) => {
      const data = {
        ...merged,
        ...(input.alertOnModerate !== undefined && {
          alertOnModerate: input.alertOnModerate,
        }),
        ...(input.alertOnDka !== undefined && { alertOnDka: input.alertOnDka }),
      }

      const updated = await tx.ketoneThreshold.upsert({
        where: { patientId },
        update: data,
        create: { patientId, ...data },
      })

      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "UPDATE",
        resource: "PATIENT",
        resourceId: `${patientId}:ketone-thresholds`,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        metadata: { thresholds: merged },
      })

      return updated
    })
  },
}
