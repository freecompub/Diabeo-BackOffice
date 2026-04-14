/**
 * @module insulin.service
 * @description Bolus calculation engine with clinical safety bounds.
 * Implements insulin-to-carb ratio (ICR), insulin sensitivity factor (ISF),
 * and Insulin-On-Board (IOB) adjustment per ADA/EASD consensus.
 * All suggestions are immutable logs — never auto-injected without patient acceptance.
 * @see CLAUDE.md#insulin-logic — Bolus calculation formula and clinical bounds
 * @see CLAUDE.md#insulin-validation — Medical domain validation
 * @see Prisma schema — InsulinTherapySettings, BolusCalculationLog models
 * @see https://diabetes.org/about-us/statistics/statistics-about-diabetes — ADA guidelines
 */

import type { InsulinDeliveryMethod } from "@prisma/client"
import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import { CLINICAL_BOUNDS } from "@/lib/clinical-bounds"

// CLINICAL_BOUNDS imported from @/lib/clinical-bounds (single source of truth)

/**
 * Input parameters for bolus calculation.
 * @typedef {Object} BolusInput
 * @property {number} currentGlucoseGl - Current glucose in g/L (0.40-5.00 valid range)
 * @property {number} carbsGrams - Meal carbohydrate content (≥0)
 * @property {number} patientId - Patient ID for settings lookup
 */
interface BolusInput {
  currentGlucoseGl: number   // g/L
  carbsGrams: number
  patientId: number
}

/**
 * Bolus calculation result — a suggestion that requires explicit patient acceptance.
 * @typedef {Object} BolusResult
 * @property {number} mealBolus - Insulin units for carbs (carbs / ICR)
 * @property {number} rawCorrectionDose - Uncapped correction dose (before IOB adjustment)
 * @property {number} iobAdjustment - Insulin-On-Board adjustment (currently 0)
 * @property {number} correctionDose - Final correction (max(0, raw - IOB))
 * @property {number} recommendedDose - Total (meal + correction), capped, device-rounded
 * @property {boolean} wasCapped - True if recommendedDose hit MAX_SINGLE_BOLUS cap
 * @property {Array<string>} warnings - Clinical warnings (hypoglycemia, hyperglycemia, capped)
 * @property {boolean} requiresHypoTreatmentFirst - True if glucose < 70 mg/dL (0.70 g/L)
 * @property {InsulinDeliveryMethod} deliveryMethod - pump or manual (affects rounding precision)
 */
interface BolusResult {
  mealBolus: number
  rawCorrectionDose: number
  iobAdjustment: number
  correctionDose: number
  recommendedDose: number
  wasCapped: boolean
  warnings: string[]
  requiresHypoTreatmentFirst: boolean
  deliveryMethod: InsulinDeliveryMethod
}

/**
 * Insulin therapy service — bolus calculations and settings management.
 * @namespace insulinService
 */
export const insulinService = {
  /**
   * Retrieve full insulin therapy settings for a patient.
   * Includes: glucose targets, ISF/ICR by hour, basal config with pump slots, IOB settings.
   * @async
   * @param {number} patientId - Patient ID
   * @returns {Promise<Object | null>} InsulinTherapySettings with all relations, or null if not configured
   * @example
   * const settings = await insulinService.getSettings(patientId)
   * if (settings) {
   *   const isf = settings.sensitivityFactors[0]  // Sorted by startHour
   *   const icr = settings.carbRatios[0]
   * }
   */
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
   * Calculate bolus recommendation based on current glucose and meal carbs.
   * Returns a SUGGESTION only — never auto-injected. Patient must accept explicitly.
   * Formula: mealBolus = carbs / ICR; correctionDose = (glucose - target) / ISF; total = meal + correction.
   * Device-aware rounding: 0.05 U for pump, 0.5 U for pen.
   * All bounds checked per CLINICAL_BOUNDS. Warnings emitted for hypo/hyper conditions.
   * BolusCalculationLog + AuditLog written atomically in one transaction.
   * @async
   * @param {BolusInput} input - Current glucose (g/L), carbs (g), patientId
   * @param {number} auditUserId - User ID performing calculation (audit trail)
   * @returns {Promise<BolusResult>} Recommendation object with warnings and flags
   * @throws {Error} If patient has no insulin settings, ISF/ICR/target not found, or zero ISF/ICR
   * @see CLAUDE.md#insulin-logic — Full formula and rationale
   * @see clinicalBounds — Safety limits
   * @example
   * const result = await insulinService.calculateBolus({
   *   currentGlucoseGl: 1.50,  // 150 mg/dL
   *   carbsGrams: 45,
   *   patientId: 123
   * }, auditUserId)
   * // result.recommendedDose = capped, device-rounded suggestion
   * // result.warnings = ['...'] if any flags
   * // Create AdjustmentProposal with status='pending' for patient acceptance
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

    const isfGl = isf.sensitivityFactorGl.toNumber()
    const isfMgdl = isf.sensitivityFactorMgdl.toNumber()
    const icrValue = icr.gramsPerUnit.toNumber()
    const targetMgdl = target.targetGlucose.toNumber()
    const currentMgdl = input.currentGlucoseGl * 100 // g/L -> mg/dL

    // Division-by-zero safety guards
    if (isfMgdl <= 0) throw new Error("ISF value is zero or negative — cannot calculate bolus")
    if (icrValue <= 0) throw new Error("ICR value is zero or negative — cannot calculate bolus")

    // Meal bolus
    const mealBolus = input.carbsGrams / icrValue

    // Correction dose
    const rawCorrectionDose = (currentMgdl - targetMgdl) / isfMgdl

    // IOB adjustment
    // IOB (Insulin On Board) — deduct active insulin from recent boluses (HR-1)
    let iobValue = 0
    let iobAdjustment = 0
    if (settings.iobSettings?.considerIob) {
      // Use ?? (nullish) not || — a stored Decimal of 0 is a CORRUPT config,
      // not "use default". Masking 0 with 4h disables IOB subtraction silently
      // → insulin stacking risk. Reject explicitly so the config bug surfaces.
      const actionDuration = settings.iobSettings.actionDurationHours?.toNumber() ?? 4.0
      if (actionDuration <= 0) {
        throw new Error(
          "IOB actionDurationHours is zero or negative — invalid insulin therapy config",
        )
      }
      iobValue = await calculateIob(input.patientId, actionDuration)
      // IOB only reduces correction dose, never meal bolus
      iobAdjustment = Math.min(iobValue, Math.max(0, rawCorrectionDose))
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
          iobValue: roundToHundredths(iobValue),
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
   * Validate insulin therapy settings — DOCTOR-only action.
   * Marks settings as medically validated before they become active.
   * TODO(Phase 4 — US-400): Implement with validatedById/validatedAt on InsulinTherapySettings.
   * @async
   * @param {number} _patientId - Patient ID (unused, reserved for Phase 4)
   * @param {number} _doctorUserId - Doctor ID (unused, reserved for Phase 4)
   * @returns {Promise<never>} Throws error (not yet implemented)
   * @throws {Error} Always throws — Phase 4 feature
   */
  async validateSettings(_patientId: number, _doctorUserId: number): Promise<never> {
    throw new Error(
      "Not implemented — insulin therapy validation requires Phase 4 (US-400). " +
      "The schema needs validatedById/validatedAt fields on InsulinTherapySettings."
    )
  },
}

/**
 * Find the active time slot for a given hour, supporting midnight crossing.
 * If slot.startHour > slot.endHour (e.g., 22:00 → 06:00), wraps around midnight.
 * Used by ISF/ICR slot selection — called at bolus calculation time.
 * @private
 * @template T - Slot type with startHour and endHour
 * @param {Array<T>} slots - Sorted slots by startHour
 * @param {number} hour - Hour of day (0-23)
 * @returns {T | undefined} Matching slot or undefined if no match
 */
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

/**
 * Device-aware dose rounding per delivery precision.
 * Pumps typically support 0.05 U increments; pens 0.5 U increments.
 * @private
 * @param {number} dose - Unrounded dose (units)
 * @param {InsulinDeliveryMethod} method - "pump" (0.05 U increments) or "manual" (0.5 U)
 * @returns {number} Rounded dose for delivery device
 *
 * NOTE: Exhaustive switch + `never` check — adding a new variant to the enum
 * (e.g. pen, inhaled/Afrezza with 4/8/12 U cartridges) will fail at compile time
 * rather than silently default to 0.5 U increments. Medical devices require an
 * explicit rounding policy per delivery method.
 */
function roundForDevice(dose: number, method: InsulinDeliveryMethod): number {
  switch (method) {
    case "pump":
      return Math.round(dose * 20) / 20  // 0.05 U increments
    case "manual":
      return Math.round(dose * 2) / 2    // 0.5 U increments (pen/manual)
    default: {
      const _exhaustive: never = method
      throw new Error(`Unsupported InsulinDeliveryMethod: ${_exhaustive}`)
    }
  }
}

/**
 * Round to 0.01 precision (hundredths) for intermediate calculations.
 * Used in BolusCalculationLog storage and audit metadata.
 * @private
 * @param {number} n - Value to round
 * @returns {number} Rounded to 2 decimal places
 */
function roundToHundredths(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Calculate Insulin On Board (IOB) from recent bolus logs.
 *
 * Uses a linear decay model:
 *   remaining = max(0, 1 - elapsedHours / actionDuration)
 *   IOB = sum(recommendedDose * remaining) for each recent bolus
 *
 * Only considers boluses within the action duration window.
 * Clinical reference: rapid-acting insulin pharmacokinetics (3.5-5h).
 *
 * @param patientId - Patient ID
 * @param actionDurationHours - Insulin action duration (typically 3.5-5h)
 * @returns Total IOB in units
 */
async function calculateIob(
  patientId: number,
  actionDurationHours: number,
): Promise<number> {
  // Guard against division by zero (C2 fix)
  if (actionDurationHours <= 0) {
    throw new Error("actionDurationHours must be positive — cannot calculate IOB")
  }

  const cutoff = new Date(Date.now() - actionDurationHours * 3600_000)

  // Only count DELIVERED boluses — suggestions not yet accepted must not
  // contribute to IOB, otherwise we under-dose hyperglycemic patients (C1 fix)
  const recentBoluses = await prisma.bolusCalculationLog.findMany({
    where: {
      patientId,
      calculatedAt: { gte: cutoff },
      wasDelivered: true,
    },
    select: {
      recommendedDose: true,
      calculatedAt: true,
    },
    orderBy: { calculatedAt: "desc" },
  })

  let totalIob = 0
  const now = Date.now()

  for (const bolus of recentBoluses) {
    const elapsedHours = (now - bolus.calculatedAt.getTime()) / 3600_000
    const remaining = Math.max(0, 1 - elapsedHours / actionDurationHours)
    totalIob += bolus.recommendedDose.toNumber() * remaining
  }

  return roundToHundredths(totalIob)
}
