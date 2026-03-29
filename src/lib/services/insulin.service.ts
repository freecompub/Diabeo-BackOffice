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
}

/** Sélectionne le ratio applicable pour une heure donnée */
function getRatioForHour(ratios: HourlyValue[], hour: number): number {
  const sorted = [...ratios].sort((a, b) => b.hour - a.hour)
  const match = sorted.find((r) => r.hour <= hour)
  return match?.value ?? sorted[sorted.length - 1].value
}

export const insulinService = {
  async createConfig(input: CreateInsulinConfigInput, userId: string) {
    const config = await prisma.insulinConfig.create({
      data: {
        patientId: input.patientId,
        sensitivityRatios: input.sensitivityRatios as unknown as Prisma.JsonArray,
        carbRatios: input.carbRatios as unknown as Prisma.JsonArray,
        basalRates: input.basalRates as unknown as Prisma.JsonArray,
        targetGlucose: input.targetGlucose as unknown as Prisma.JsonArray,
        isActive: false,
      },
    })

    await auditService.log({
      userId,
      action: "CREATE",
      resource: "INSULIN_CONFIG",
      resourceId: config.id,
    })

    return config
  },

  /** Seul un DOCTOR peut valider une config */
  async validateConfig(configId: string, doctorId: string) {
    // Désactiver toutes les configs actives du patient
    const config = await prisma.insulinConfig.findUniqueOrThrow({
      where: { id: configId },
    })

    await prisma.insulinConfig.updateMany({
      where: { patientId: config.patientId, isActive: true },
      data: { isActive: false },
    })

    const validated = await prisma.insulinConfig.update({
      where: { id: configId },
      data: {
        isActive: true,
        validatedById: doctorId,
        validatedAt: new Date(),
      },
    })

    await auditService.log({
      userId: doctorId,
      action: "UPDATE",
      resource: "INSULIN_CONFIG",
      resourceId: configId,
      metadata: { action: "validate" },
    })

    return validated
  },

  /** Calcul du bolus */
  calculateBolus(
    carbsGrams: number,
    currentGlucose: number,
    config: {
      carbRatios: HourlyValue[]
      sensitivityRatios: HourlyValue[]
      targetGlucose: GlucoseTarget[]
    },
    hour: number
  ) {
    const carbRatio = getRatioForHour(config.carbRatios, hour)
    const sensitivityRatio = getRatioForHour(config.sensitivityRatios, hour)

    const targetSorted = [...config.targetGlucose].sort(
      (a, b) => b.hour - a.hour
    )
    const target = targetSorted.find((t) => t.hour <= hour) ??
      targetSorted[targetSorted.length - 1]

    const targetMid = (target.min + target.max) / 2

    const mealBolus = carbsGrams / carbRatio
    const correctionBolus = Math.max(
      0,
      (currentGlucose - targetMid) / sensitivityRatio
    )

    const total = Math.round((mealBolus + correctionBolus) * 10) / 10

    return { mealBolus, correctionBolus, total }
  },
}
