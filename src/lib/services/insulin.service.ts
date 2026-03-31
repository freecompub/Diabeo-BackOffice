import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import type { InsulinDeliveryMethod } from "@prisma/client"

/** Clinical safety bounds */
const CLINICAL_BOUNDS = {
  ISF_GL_MIN: 0.20,    // g/L/U
  ISF_GL_MAX: 1.00,    // g/L/U
  ISF_MGDL_MIN: 20,    // mg/dL/U
  ISF_MGDL_MAX: 100,   // mg/dL/U
  ICR_MIN: 5.0,        // g/U
  ICR_MAX: 20.0,       // g/U
  BASAL_MIN: 0.05,     // U/h
  BASAL_MAX: 10.0,     // U/h
  TARGET_MIN_MGDL: 60,
  TARGET_MAX_MGDL: 250,
  MAX_SINGLE_BOLUS: 25.0, // U
  INSULIN_ACTION_MIN: 3.5,
  INSULIN_ACTION_MAX: 5.0,
  PUMP_BASAL_INCREMENT: 0.05, // U/h
} as const

interface BolusInput {
  currentGlucoseGl: number   // g/L
  carbsGrams: number
  patientId: number
}

interface BolusResult {
  mealBolus: number
  rawCorrectionDose: number
  iobAdjustment: number
  correctionDose: number
  recommendedDose: number
  wasCapped: boolean
  warnings: string[]
  deliveryMethod: string
}

export const insulinService = {
  /** Retrieve full insulin therapy settings for a patient */
  async getSettings(patientId: number) {
    return prisma.insulinTherapySettings.findUnique({
      where: { patientId },
      include: {
        glucoseTargets: { where: { isActive: true } },
        iobSettings: true,
        extendedBolusSettings: true,
        sensitivityFactors: { orderBy: { startHour: "asc" } },
        carbRatios: { orderBy: { startHour: "asc" } },
        basalConfiguration: { include: { pumpSlots: { orderBy: { startTime: "asc" } } } },
      },
    })
  },

  /**
   * Calculate bolus — returns a suggestion, never a prescription.
   * Logs the calculation for medical traceability.
   */
  async calculateBolus(input: BolusInput, auditUserId: number): Promise<BolusResult> {
    const settings = await this.getSettings(input.patientId)
    if (!settings) throw new Error("No insulin therapy settings found for patient")

    const hour = new Date().getHours()

    // Find applicable ISF for current hour
    const isf = findSlotForHour(settings.sensitivityFactors, hour)
    if (!isf) throw new Error("No ISF slot found for current hour")

    // Find applicable ICR for current hour
    const icr = findSlotForHour(settings.carbRatios, hour)
    if (!icr) throw new Error("No ICR slot found for current hour")

    // Active glucose target
    const target = settings.glucoseTargets[0]
    if (!target) throw new Error("No active glucose target found")

    const isfGl = Number(isf.sensitivityFactorGl)
    const icrValue = Number(icr.gramsPerUnit)
    const targetMgdl = Number(target.targetGlucose)
    const currentMgdl = input.currentGlucoseGl * 100 // g/L -> mg/dL

    // Meal bolus
    const mealBolus = input.carbsGrams / icrValue

    // Correction dose
    const rawCorrectionDose = (currentMgdl - targetMgdl) / Number(isf.sensitivityFactorMgdl)

    // IOB adjustment
    let iobAdjustment = 0
    const iob = settings.iobSettings
    if (iob?.considerIob) {
      // IOB value would come from recent bolus history — placeholder for now
      iobAdjustment = 0
    }

    const correctionDose = Math.max(0, rawCorrectionDose - iobAdjustment)
    const rawTotal = mealBolus + correctionDose
    const recommendedDose = Math.round(Math.min(rawTotal, CLINICAL_BOUNDS.MAX_SINGLE_BOLUS) * 10) / 10
    const wasCapped = rawTotal > CLINICAL_BOUNDS.MAX_SINGLE_BOLUS

    // Warnings
    const warnings: string[] = []
    if (input.currentGlucoseGl < 0.54) warnings.push("severeHypoglycemia")
    else if (input.currentGlucoseGl < 0.70) warnings.push("hypoglycemia")
    if (input.currentGlucoseGl > 2.50) warnings.push("severeHyperglycemia")
    if (input.currentGlucoseGl > 4.00) warnings.push("criticalHighGlucose")
    if (wasCapped) warnings.push("exceedsMaximumBolus")

    // Log the calculation for medical traceability
    await prisma.bolusCalculationLog.create({
      data: {
        patientId: input.patientId,
        inputGlucoseGl: input.currentGlucoseGl,
        inputCarbsGrams: input.carbsGrams,
        targetGlucoseMgdl: targetMgdl,
        isfUsedGl: isfGl,
        icrUsed: icrValue,
        mealBolus: round2(mealBolus),
        rawCorrectionDose: round2(rawCorrectionDose),
        iobValue: 0,
        iobAdjustment: round2(iobAdjustment),
        correctionDose: round2(correctionDose),
        recommendedDose,
        wasCapped,
        warnings,
        deliveryMethod: settings.deliveryMethod,
      },
    })

    await auditService.log({
      userId: auditUserId,
      action: "BOLUS_CALCULATED",
      resource: "BOLUS_LOG",
      resourceId: String(input.patientId),
      metadata: { recommendedDose, warnings },
    })

    return {
      mealBolus: round2(mealBolus),
      rawCorrectionDose: round2(rawCorrectionDose),
      iobAdjustment: round2(iobAdjustment),
      correctionDose: round2(correctionDose),
      recommendedDose,
      wasCapped,
      warnings,
      deliveryMethod: settings.deliveryMethod,
    }
  },

  /** Only a DOCTOR can validate — role must be checked by the caller */
  async validateSettings(patientId: number, doctorUserId: number) {
    const settings = await prisma.insulinTherapySettings.findUnique({
      where: { patientId },
    })

    if (!settings) throw new Error("No insulin therapy settings found")

    const updated = await prisma.insulinTherapySettings.update({
      where: { patientId },
      data: { lastModified: new Date() },
    })

    await auditService.log({
      userId: doctorUserId,
      action: "UPDATE",
      resource: "INSULIN_THERAPY",
      resourceId: String(settings.id),
      metadata: { action: "validate" },
    })

    return updated
  },
}

/** Find the time slot applicable for a given hour (supports midnight crossing) */
function findSlotForHour<T extends { startHour: number; endHour: number }>(
  slots: T[],
  hour: number,
): T | undefined {
  return slots.find((s) => {
    if (s.startHour <= s.endHour) {
      return hour >= s.startHour && hour < s.endHour
    }
    // Midnight crossing (e.g., 22h -> 6h)
    return hour >= s.startHour || hour < s.endHour
  })
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
