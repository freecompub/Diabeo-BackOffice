import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import type { Prisma } from "@prisma/client"

interface HourlyValue {
  hour: number
  value: number
}

interface GlucoseTarget {
  hour: number
  min: number
  max: number
}

interface CreateInsulinConfigInput {
  patientId: string
  sensitivityRatios: HourlyValue[]
  carbRatios: HourlyValue[]
  basalRates: HourlyValue[]
  targetGlucose: GlucoseTarget[]
  maxBolus?: number
}

/** Bornes cliniques de sécurité */
const CLINICAL_BOUNDS = {
  ISF_MIN: 10,
  ISF_MAX: 100,
  ICR_MIN: 3,
  ICR_MAX: 30,
  BASAL_MIN: 0.05,
  BASAL_MAX: 5.0,
  TARGET_MIN: 60,
  TARGET_MAX: 250,
  DEFAULT_MAX_BOLUS: 25,
} as const

/** Sélectionne le ratio applicable pour une heure donnée */
function getRatioForHour(ratios: HourlyValue[], hour: number): number {
  if (ratios.length === 0) {
    throw new Error("Ratio array must not be empty")
  }
  const sorted = [...ratios].sort((a, b) => b.hour - a.hour)
  const match = sorted.find((r) => r.hour <= hour)
  return match?.value ?? sorted[sorted.length - 1].value
}

function getTargetForHour(targets: GlucoseTarget[], hour: number): GlucoseTarget {
  if (targets.length === 0) {
    throw new Error("Target glucose array must not be empty")
  }
  const sorted = [...targets].sort((a, b) => b.hour - a.hour)
  const match = sorted.find((t) => t.hour <= hour)
  return match ?? sorted[sorted.length - 1]
}

/** Valide les bornes cliniques d'une config insuline */
function validateClinicalBounds(input: CreateInsulinConfigInput): void {
  for (const r of input.sensitivityRatios) {
    if (r.value < CLINICAL_BOUNDS.ISF_MIN || r.value > CLINICAL_BOUNDS.ISF_MAX) {
      throw new Error(
        `ISF ${r.value} at hour ${r.hour} is outside clinical bounds [${CLINICAL_BOUNDS.ISF_MIN}-${CLINICAL_BOUNDS.ISF_MAX}]`
      )
    }
  }
  for (const r of input.carbRatios) {
    if (r.value < CLINICAL_BOUNDS.ICR_MIN || r.value > CLINICAL_BOUNDS.ICR_MAX) {
      throw new Error(
        `ICR ${r.value} at hour ${r.hour} is outside clinical bounds [${CLINICAL_BOUNDS.ICR_MIN}-${CLINICAL_BOUNDS.ICR_MAX}]`
      )
    }
  }
  for (const r of input.basalRates) {
    if (r.value < CLINICAL_BOUNDS.BASAL_MIN || r.value > CLINICAL_BOUNDS.BASAL_MAX) {
      throw new Error(
        `Basal rate ${r.value} at hour ${r.hour} is outside clinical bounds [${CLINICAL_BOUNDS.BASAL_MIN}-${CLINICAL_BOUNDS.BASAL_MAX}]`
      )
    }
  }
  for (const t of input.targetGlucose) {
    if (t.min < CLINICAL_BOUNDS.TARGET_MIN) {
      throw new Error(`Target min ${t.min} at hour ${t.hour} is below ${CLINICAL_BOUNDS.TARGET_MIN} mg/dL`)
    }
    if (t.max > CLINICAL_BOUNDS.TARGET_MAX) {
      throw new Error(`Target max ${t.max} at hour ${t.hour} is above ${CLINICAL_BOUNDS.TARGET_MAX} mg/dL`)
    }
    if (t.min >= t.max) {
      throw new Error(`Target min (${t.min}) must be less than max (${t.max}) at hour ${t.hour}`)
    }
  }
}

export const insulinService = {
  async createConfig(input: CreateInsulinConfigInput, userId: string) {
    validateClinicalBounds(input)

    return prisma.$transaction(async (tx) => {
      const config = await tx.insulinConfig.create({
        data: {
          patientId: input.patientId,
          createdById: userId,
          sensitivityRatios: input.sensitivityRatios as unknown as Prisma.JsonArray,
          carbRatios: input.carbRatios as unknown as Prisma.JsonArray,
          basalRates: input.basalRates as unknown as Prisma.JsonArray,
          targetGlucose: input.targetGlucose as unknown as Prisma.JsonArray,
          maxBolus: input.maxBolus ?? CLINICAL_BOUNDS.DEFAULT_MAX_BOLUS,
          isActive: false,
        },
      })

      await auditService.logWithTx(tx, {
        userId,
        action: "CREATE",
        resource: "INSULIN_CONFIG",
        resourceId: config.id,
      })

      return config
    })
  },

  /** Seul un DOCTOR peut valider une config — le rôle doit être vérifié par l'appelant */
  async validateConfig(configId: string, doctorId: string) {
    return prisma.$transaction(async (tx) => {
      const config = await tx.insulinConfig.findUniqueOrThrow({
        where: { id: configId },
      })

      // Désactiver toutes les configs actives du patient
      await tx.insulinConfig.updateMany({
        where: { patientId: config.patientId, isActive: true },
        data: { isActive: false },
      })

      const validated = await tx.insulinConfig.update({
        where: { id: configId },
        data: {
          isActive: true,
          validatedById: doctorId,
          validatedAt: new Date(),
        },
      })

      await auditService.logWithTx(tx, {
        userId: doctorId,
        action: "UPDATE",
        resource: "INSULIN_CONFIG",
        resourceId: configId,
        metadata: { action: "validate" },
      })

      return validated
    })
  },

  /** Calcul du bolus — retourne une suggestion, jamais une prescription */
  calculateBolus(
    carbsGrams: number,
    currentGlucose: number,
    config: {
      carbRatios: HourlyValue[]
      sensitivityRatios: HourlyValue[]
      targetGlucose: GlucoseTarget[]
      maxBolus?: number
    },
    hour: number
  ) {
    const carbRatio = getRatioForHour(config.carbRatios, hour)
    const sensitivityRatio = getRatioForHour(config.sensitivityRatios, hour)
    const target = getTargetForHour(config.targetGlucose, hour)

    if (carbRatio <= 0 || sensitivityRatio <= 0) {
      throw new Error("carbRatio and sensitivityRatio must be positive non-zero values")
    }

    const targetMid = (target.min + target.max) / 2
    const mealBolus = carbsGrams / carbRatio
    const correctionBolus = Math.max(
      0,
      (currentGlucose - targetMid) / sensitivityRatio
    )

    const rawTotal = mealBolus + correctionBolus
    const maxBolus = config.maxBolus ?? CLINICAL_BOUNDS.DEFAULT_MAX_BOLUS
    const total = Math.round(Math.min(rawTotal, maxBolus) * 10) / 10
    const capped = rawTotal > maxBolus

    return { mealBolus, correctionBolus, total, capped, maxBolus }
  },
}
