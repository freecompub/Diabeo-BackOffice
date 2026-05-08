/**
 * @module hypo-treatment.service
 * @description US-2217 — Hypoglycemia treatment protocol per patient.
 *
 * Clinical reference: ADA "Rule of 15/15" — for non-severe hypoglycemia, ingest
 * 15 g of fast-acting carbs, retest blood glucose in 15 minutes, repeat if still
 * < 70 mg/dL. Sugar type adapted to patient preferences/allergies.
 *
 * Personal medical content (allergies, instructions) is encrypted at rest.
 */

import { prisma } from "@/lib/db/client"
import { encryptField, safeDecryptField } from "@/lib/crypto/fields"
import { auditService } from "./audit.service"
import type { AuditContext } from "./patient.service"
import type { HypoSugarType } from "@prisma/client"

/**
 * Standard ADA defaults — adult, non-severe hypoglycemia.
 */
export const HYPO_TREATMENT_DEFAULTS = {
  sugarType: "glucose_tabs" as HypoSugarType,
  fastCarbsGrams: 15,
  retestMinutes: 15,
} as const

/**
 * Clinical bounds — refuse values that could harm a patient.
 * Carbs: 5–60 g (smaller for children, never above 60 g per ingestion).
 * Retest: 5–30 minutes — ADA "Rule of 15/15" prescribes 15 min; ceiling at
 * 30 min accommodates pediatric/elderly variation but never beyond, otherwise
 * neuroglycopenia risk on Level 1 hypo. Severe hypo (< 54 mg/dL) is out of
 * scope for self-treatment retest — requires glucagon / emergency response.
 */
export const HYPO_TREATMENT_BOUNDS = {
  CARBS_MIN: 5,
  CARBS_MAX: 60,
  RETEST_MIN: 5,
  RETEST_MAX: 30,
} as const

interface HypoTreatmentInput {
  sugarType?: HypoSugarType
  sugarTypeOther?: string | null
  fastCarbsGrams?: number
  retestMinutes?: number
  allergies?: string | null
  instructions?: string | null
}

export function validateHypoTreatment(input: {
  fastCarbsGrams: number
  retestMinutes: number
}): string | null {
  if (
    input.fastCarbsGrams < HYPO_TREATMENT_BOUNDS.CARBS_MIN ||
    input.fastCarbsGrams > HYPO_TREATMENT_BOUNDS.CARBS_MAX
  ) {
    return "carbs_out_of_bounds"
  }
  if (
    input.retestMinutes < HYPO_TREATMENT_BOUNDS.RETEST_MIN ||
    input.retestMinutes > HYPO_TREATMENT_BOUNDS.RETEST_MAX
  ) {
    return "retest_out_of_bounds"
  }
  return null
}

export const hypoTreatmentService = {
  async get(patientId: number, auditUserId: number, ctx?: AuditContext) {
    const [record, patient] = await Promise.all([
      prisma.hypoTreatmentProtocol.findUnique({ where: { patientId } }),
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
      resourceId: `${patientId}:hypo-treatment`,
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
    })

    if (!record) {
      return {
        patientId,
        ...HYPO_TREATMENT_DEFAULTS,
        sugarTypeOther: null,
        allergies: null,
        instructions: null,
      }
    }

    return {
      ...record,
      allergies: safeDecryptField(record.allergies),
      instructions: safeDecryptField(record.instructions),
    }
  },

  async upsert(
    patientId: number,
    input: HypoTreatmentInput,
    auditUserId: number,
    ctx?: AuditContext,
  ) {
    const fastCarbsGrams =
      input.fastCarbsGrams ?? HYPO_TREATMENT_DEFAULTS.fastCarbsGrams
    const retestMinutes =
      input.retestMinutes ?? HYPO_TREATMENT_DEFAULTS.retestMinutes

    const error = validateHypoTreatment({ fastCarbsGrams, retestMinutes })
    if (error) throw new Error(error)

    if (input.sugarType === "other" && !input.sugarTypeOther?.trim()) {
      throw new Error("sugar_type_other_required")
    }

    return prisma.$transaction(async (tx) => {
      const data = {
        sugarType: input.sugarType ?? HYPO_TREATMENT_DEFAULTS.sugarType,
        sugarTypeOther:
          input.sugarType === "other"
            ? input.sugarTypeOther?.trim() ?? null
            : null,
        fastCarbsGrams,
        retestMinutes,
        allergies: input.allergies?.trim()
          ? encryptField(input.allergies.trim())
          : null,
        instructions: input.instructions?.trim()
          ? encryptField(input.instructions.trim())
          : null,
      }

      const updated = await tx.hypoTreatmentProtocol.upsert({
        where: { patientId },
        update: data,
        create: { patientId, ...data },
      })

      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "UPDATE",
        resource: "PATIENT",
        resourceId: `${patientId}:hypo-treatment`,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        metadata: {
          sugarType: data.sugarType,
          fastCarbsGrams: data.fastCarbsGrams,
          retestMinutes: data.retestMinutes,
        },
      })

      return {
        ...updated,
        allergies: safeDecryptField(updated.allergies),
        instructions: safeDecryptField(updated.instructions),
      }
    })
  },
}
