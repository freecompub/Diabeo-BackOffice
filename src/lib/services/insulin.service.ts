import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"

/** Clinical safety bounds (validated by medical-domain-validator) */
const CLINICAL_BOUNDS = {
  ISF_GL_MIN: 0.10,    // g/L/U (widened for insulin-resistant T2D)
  ISF_GL_MAX: 1.00,    // g/L/U
  ISF_MGDL_MIN: 10,    // mg/dL/U (widened for insulin-resistant T2D)
  ISF_MGDL_MAX: 100,   // mg/dL/U
  ICR_MIN: 3.0,        // g/U (widened for pediatric + resistant)
  ICR_MAX: 30.0,       // g/U (widened for insulin-sensitive T1D)
  BASAL_MIN: 0.05,     // U/h
  BASAL_MAX: 5.0,      // U/h (lowered from 10 — 10 U/h = 240 U/day, dangerous)
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
  requiresHypoTreatmentFirst: boolean
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
   * Both the BolusCalculationLog and audit entry are in the same transaction.
   */
  async calculateBolus(input: BolusInput, auditUserId: number): Promise<BolusResult> {
    const settings = await this.getSettings(input.patientId)
    if (!settings) throw new Error("No insulin therapy settings found for patient")

    const hour = new Date().getHours()

    const isf = findSlotForHour(settings.sensitivityFactors, hour)
    if (!isf) throw new Error("No ISF slot found for current hour")

    const icr = findSlotForHour(settings.carbRatios, hour)
    if (!icr) throw new Error("No ICR slot found for current hour")

    const target = settings.glucoseTargets[0]
    if (!target) throw new Error("No active glucose target found")

    const isfGl = Number(isf.sensitivityFactorGl)
    const isfMgdl = Number(isf.sensitivityFactorMgdl)
    const icrValue = Number(icr.gramsPerUnit)
    const targetMgdl = Number(target.targetGlucose)
    const currentMgdl = input.currentGlucoseGl * 100 // g/L -> mg/dL

    // Division-by-zero safety guards
    if (isfMgdl <= 0) throw new Error("ISF value is zero or negative — cannot calculate bolus")
    if (icrValue <= 0) throw new Error("ICR value is zero or negative — cannot calculate bolus")

    // Meal bolus
    const mealBolus = input.carbsGrams / icrValue

    // Correction dose
    const rawCorrectionDose = (currentMgdl - targetMgdl) / isfMgdl

    // IOB adjustment
    let iobAdjustment = 0
    if (settings.iobSettings?.considerIob) {
      // IOB value would come from recent bolus history — placeholder
      iobAdjustment = 0
    }

    const correctionDose = Math.max(0, rawCorrectionDose - iobAdjustment)
    const rawTotal = mealBolus + correctionDose
    // Device-aware rounding: 0.05 U for pump, 0.5 U for pen
    const capped = Math.min(rawTotal, CLINICAL_BOUNDS.MAX_SINGLE_BOLUS)
    const recommendedDose = roundForDevice(capped, settings.deliveryMethod)
    const wasCapped = rawTotal > CLINICAL_BOUNDS.MAX_SINGLE_BOLUS

    // Warnings + hypo treatment flag
    const warnings: string[] = []
    const requiresHypoTreatmentFirst = input.currentGlucoseGl < 0.70
    if (input.currentGlucoseGl < 0.54) warnings.push("severeHypoglycemia")
    else if (input.currentGlucoseGl < 0.70) warnings.push("hypoglycemia")
    if (input.currentGlucoseGl > 2.50) warnings.push("severeHyperglycemia")
    if (input.currentGlucoseGl > 4.00) warnings.push("criticalHighGlucose")
    if (wasCapped) warnings.push("exceedsMaximumBolus")

    // Transaction: bolus log + audit in one atomic write
    await prisma.$transaction(async (tx) => {
      await tx.bolusCalculationLog.create({
        data: {
          patientId: input.patientId,
          inputGlucoseGl: input.currentGlucoseGl,
          inputCarbsGrams: input.carbsGrams,
          targetGlucoseMgdl: targetMgdl,
          isfUsedGl: isfGl,
          icrUsed: icrValue,
          mealBolus: roundToHundredths(mealBolus),
          rawCorrectionDose: roundToHundredths(rawCorrectionDose),
          iobValue: 0,
          iobAdjustment: roundToHundredths(iobAdjustment),
          correctionDose: roundToHundredths(correctionDose),
          recommendedDose,
          wasCapped,
          warnings,
          deliveryMethod: settings.deliveryMethod,
        },
      })

      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "BOLUS_CALCULATED",
        resource: "BOLUS_LOG",
        resourceId: String(input.patientId),
        metadata: {
          inputGlucoseGl: input.currentGlucoseGl,
          inputCarbsGrams: input.carbsGrams,
          isfUsedGl: isfGl,
          icrUsed: icrValue,
          recommendedDose,
          warnings,
        },
      })
    })

    return {
      mealBolus: roundToHundredths(mealBolus),
      rawCorrectionDose: roundToHundredths(rawCorrectionDose),
      iobAdjustment: roundToHundredths(iobAdjustment),
      correctionDose: roundToHundredths(correctionDose),
      recommendedDose,
      wasCapped,
      warnings,
      requiresHypoTreatmentFirst,
      deliveryMethod: settings.deliveryMethod,
    }
  },

  /**
   * Validate insulin therapy settings — only a DOCTOR can validate.
   * Role must be checked by the caller.
   * TODO(Phase 4 — US-400): implement full validation with isActive flag
   * when InsulinTherapySettings gets validatedById/validatedAt fields.
   */
  async validateSettings(_patientId: number, _doctorUserId: number): Promise<never> {
    throw new Error(
      "Not implemented — insulin therapy validation requires Phase 4 (US-400). " +
      "The schema needs validatedById/validatedAt fields on InsulinTherapySettings."
    )
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

/** Device-aware rounding: 0.05 U for pump, 0.5 U for pen */
function roundForDevice(dose: number, method: string): number {
  if (method === "pump") return Math.round(dose * 20) / 20   // 0.05 U increments
  return Math.round(dose * 2) / 2                             // 0.5 U increments (pen)
}

/** Round to 0.01 for intermediate values */
function roundToHundredths(n: number): number {
  return Math.round(n * 100) / 100
}
