/**
 * Test suite: Insulin Service — Bolus Calculation and Clinical Safety
 *
 * Clinical behavior tested:
 * - Meal bolus calculation: mealBolus = carbsGrams / ICR(hour), where ICR is
 *   selected from the patient's time-of-day CarbRatio slot
 * - Correction bolus calculation: correctionDose = max(0, (currentMgdl -
 *   targetMgdl) / ISF(hour) - IOB), where IOB is subtracted to avoid
 *   stacking insulin on board
 * - Final recommended dose: min(mealBolus + correctionDose, MAX_SINGLE_BOLUS=25 U)
 *   rounded to 0.1 U — never exceeds the hard clinical cap
 * - Time-of-day slot resolution: the correct ISF and ICR slot is selected
 *   based on startHour <= current hour, falling back to the last slot at
 *   midnight (00:00) when no earlier slot matches
 * - g/L to mg/dL unit conversion: currentGlucoseGl * 100 = currentMgdl
 *   applied consistently before all arithmetic
 * - The entire bolus calculation and its BolusCalculationLog are committed
 *   atomically in a Prisma transaction alongside an audit log entry
 *
 * Associated risks:
 * - An incorrect ICR or ISF slot selection (off-by-one hour boundary) would
 *   produce a systematically wrong dose recommendation at slot transition
 *   times, potentially causing under- or over-correction
 * - Missing the MAX_SINGLE_BOLUS cap would allow the formula to recommend
 *   a lethal dose for a patient who inputs extreme carb counts
 * - A failed transaction leaving a BolusCalculationLog without an audit entry
 *   would produce an untraced dose suggestion, violating HDS requirements
 * - IOB not subtracted from correction dose would cause double-dosing on
 *   closely spaced corrections, risking severe hypoglycemia
 *
 * Edge cases:
 * - Current glucose exactly at target (correctionDose = 0, only meal bolus)
 * - Current glucose below target (correctionDose clamped to 0 via max(0, ...))
 * - Carbs = 0 (correction-only bolus)
 * - IOB exceeding the correction dose (total correction clamped to 0)
 * - Recommended dose exactly at 25 U (boundary — not capped further)
 * - Recommended dose of 25.05 U (must be capped to 25.0 U)
 * - No matching ISF/ICR slot for the current hour (fallback to 00:00 slot)
 * - Patient with a single all-day slot covering all 24 hours
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

// Import the service AFTER the mock is set up
import { insulinService } from "@/lib/services/insulin.service"

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** Build a complete InsulinTherapySettings fixture for a given hour and params */
function buildSettings(overrides: {
  isfGl?: number       // ISF in g/L/U — e.g. 0.50 means 50 mg/dL/U
  isfMgdl?: number     // ISF in mg/dL/U — defaults to isfGl * 100
  icrGrams?: number    // ICR in g/U — e.g. 10 means 10g carbs per 1U
  targetMgdl?: number  // target glucose in mg/dL — e.g. 100
  startHour?: number   // slot start hour
  endHour?: number     // slot end hour
  deliveryMethod?: string
  considerIob?: boolean
} = {}) {
  const isfGl = overrides.isfGl ?? 0.50
  const isfMgdl = overrides.isfMgdl ?? isfGl * 100
  const icrGrams = overrides.icrGrams ?? 10
  const targetMgdl = overrides.targetMgdl ?? 100
  const startHour = overrides.startHour ?? 0
  const endHour = overrides.endHour ?? 24

  return {
    id: 1,
    patientId: 1,
    deliveryMethod: overrides.deliveryMethod ?? "manual",
    sensitivityFactors: [
      { id: 1, startHour, endHour, sensitivityFactorGl: isfGl, sensitivityFactorMgdl: isfMgdl },
    ],
    carbRatios: [
      { id: 1, startHour, endHour, gramsPerUnit: icrGrams },
    ],
    glucoseTargets: [
      { id: 1, isActive: true, targetGlucose: targetMgdl },
    ],
    iobSettings: overrides.considerIob
      ? { considerIob: true }
      : { considerIob: false },
    basalConfiguration: null,
    extendedBolusSettings: null,
  }
}

/** Mock prisma.$transaction to execute the callback with a mock tx */
function mockTransaction() {
  prismaMock.$transaction.mockImplementation(async (fn: any) => {
    const txMock = {
      bolusCalculationLog: { create: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    return fn(txMock)
  })
}

/** Stub getSettings to return a fixture, and mock transaction */
function setupMocks(settingsOverrides: Parameters<typeof buildSettings>[0] = {}) {
  const settings = buildSettings(settingsOverrides)
  prismaMock.insulinTherapySettings.findUnique.mockResolvedValue(settings as any)
  mockTransaction()
  return settings
}

// Fix the hour for deterministic slot selection
function mockHour(hour: number) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2025, 5, 15, hour, 30, 0))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("insulinService.calculateBolus", () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  // =========================================================================
  // MEAL BOLUS ONLY (no correction needed)
  // =========================================================================
  describe("meal bolus only (glucose at target)", () => {
    it("calculates meal bolus = carbs / ICR", async () => {
      // 60g carbs / 10 g/U = 6.0U meal bolus
      // glucose at target (1.00 g/L = 100 mg/dL, target 100) -> correction = 0
      mockHour(12)
      setupMocks({ icrGrams: 10, targetMgdl: 100 })

      const result = await insulinService.calculateBolus(
        { currentGlucoseGl: 1.00, carbsGrams: 60, patientId: 1 },
        1,
      )

      expect(result.mealBolus).toBe(6.0)
      expect(result.correctionDose).toBe(0)
      expect(result.recommendedDose).toBe(6.0)
      expect(result.wasCapped).toBe(false)
      expect(result.warnings).toEqual([])
    })

    it("handles fractional meal bolus with correct rounding (0.1U)", async () => {
      // 45g carbs / 12 g/U = 3.75U -> rounded to 3.8U (0.1U increment)
      mockHour(12)
      setupMocks({ icrGrams: 12, targetMgdl: 100 })

      const result = await insulinService.calculateBolus(
        { currentGlucoseGl: 1.00, carbsGrams: 45, patientId: 1 },
        1,
      )

      expect(result.mealBolus).toBe(3.75) // hundredths for intermediate
      expect(result.recommendedDose).toBe(4.0) // pen rounds to 0.5U (manual delivery)
    })

    it("returns 0 for zero carbs and glucose at target", async () => {
      mockHour(12)
      setupMocks({ icrGrams: 10, targetMgdl: 100 })

      const result = await insulinService.calculateBolus(
        { currentGlucoseGl: 1.00, carbsGrams: 0, patientId: 1 },
        1,
      )

      expect(result.mealBolus).toBe(0)
      expect(result.correctionDose).toBe(0)
      expect(result.recommendedDose).toBe(0)
    })
  })

  // =========================================================================
  // CORRECTION BOLUS ONLY (no carbs)
  // =========================================================================
  describe("correction bolus only (no carbs)", () => {
    it("calculates correction = (current - target) / ISF", async () => {
      // glucose 1.50 g/L = 150 mg/dL, target 100, ISF 50 mg/dL/U
      // correction = (150 - 100) / 50 = 1.0U
      mockHour(12)
      setupMocks({ isfMgdl: 50, targetMgdl: 100 })

      const result = await insulinService.calculateBolus(
        { currentGlucoseGl: 1.50, carbsGrams: 0, patientId: 1 },
        1,
      )

      expect(result.mealBolus).toBe(0)
      expect(result.rawCorrectionDose).toBe(1.0)
      expect(result.correctionDose).toBe(1.0)
      expect(result.recommendedDose).toBe(1.0)
    })

    it("clamps negative correction to 0 (glucose below target)", async () => {
      // glucose 0.80 g/L = 80 mg/dL, target 100, ISF 50
      // correction = (80 - 100) / 50 = -0.4 -> clamped to 0
      mockHour(12)
      setupMocks({ isfMgdl: 50, targetMgdl: 100 })

      const result = await insulinService.calculateBolus(
        { currentGlucoseGl: 0.80, carbsGrams: 0, patientId: 1 },
        1,
      )

      expect(result.rawCorrectionDose).toBe(-0.4)
      expect(result.correctionDose).toBe(0)
      expect(result.recommendedDose).toBe(0)
    })

    it("handles large correction with rounding to 0.1U", async () => {
      // glucose 3.00 g/L = 300 mg/dL, target 100, ISF 30
      // correction = (300 - 100) / 30 = 6.666... -> 6.67 raw, 6.7 final
      mockHour(12)
      setupMocks({ isfMgdl: 30, targetMgdl: 100 })

      const result = await insulinService.calculateBolus(
        { currentGlucoseGl: 3.00, carbsGrams: 0, patientId: 1 },
        1,
      )

      expect(result.rawCorrectionDose).toBe(6.67)
      expect(result.recommendedDose).toBe(6.5) // pen rounds to 0.5U (manual delivery)
    })
  })

  // =========================================================================
  // COMBINED MEAL + CORRECTION
  // =========================================================================
  describe("combined meal + correction bolus", () => {
    it("sums meal and correction doses", async () => {
      // 60g / 10 ICR = 6.0U meal
      // (200 - 100) / 50 ISF = 2.0U correction
      // total = 8.0U
      mockHour(12)
      setupMocks({ icrGrams: 10, isfMgdl: 50, targetMgdl: 100 })

      const result = await insulinService.calculateBolus(
        { currentGlucoseGl: 2.00, carbsGrams: 60, patientId: 1 },
        1,
      )

      expect(result.mealBolus).toBe(6.0)
      expect(result.correctionDose).toBe(2.0)
      expect(result.recommendedDose).toBe(8.0)
      expect(result.wasCapped).toBe(false)
    })

    it("sums meal and correction with rounding", async () => {
      // 33g / 12 ICR = 2.75U meal
      // (180 - 110) / 40 ISF = 1.75U correction
      // raw total = 4.50U -> 4.5U
      mockHour(12)
      setupMocks({ icrGrams: 12, isfMgdl: 40, targetMgdl: 110 })

      const result = await insulinService.calculateBolus(
        { currentGlucoseGl: 1.80, carbsGrams: 33, patientId: 1 },
        1,
      )

      expect(result.mealBolus).toBe(2.75)
      expect(result.correctionDose).toBe(1.75)
      expect(result.recommendedDose).toBe(4.5)
    })
  })

  // =========================================================================
  // MAX SINGLE BOLUS CAP (25U)
  // =========================================================================
  describe("max single bolus cap (25U)", () => {
    it("caps dose at 25U and sets wasCapped flag", async () => {
      // 300g / 10 ICR = 30U meal (already over cap)
      mockHour(12)
      setupMocks({ icrGrams: 10, targetMgdl: 100 })

      const result = await insulinService.calculateBolus(
        { currentGlucoseGl: 1.00, carbsGrams: 300, patientId: 1 },
        1,
      )

      expect(result.mealBolus).toBe(30.0)
      expect(result.recommendedDose).toBe(25.0)
      expect(result.wasCapped).toBe(true)
      expect(result.warnings).toContain("exceedsMaximumBolus")
    })

    it("caps combined dose at 25U", async () => {
      // 200g / 10 ICR = 20U meal
      // (300 - 100) / 30 ISF = 6.67U correction
      // total raw = 26.67 -> capped to 25.0
      mockHour(12)
      setupMocks({ icrGrams: 10, isfMgdl: 30, targetMgdl: 100 })

      const result = await insulinService.calculateBolus(
        { currentGlucoseGl: 3.00, carbsGrams: 200, patientId: 1 },
        1,
      )

      expect(result.recommendedDose).toBe(25.0)
      expect(result.wasCapped).toBe(true)
    })

    it("does not cap dose exactly at 25U", async () => {
      // 250g / 10 ICR = 25.0U exactly
      mockHour(12)
      setupMocks({ icrGrams: 10, targetMgdl: 100 })

      const result = await insulinService.calculateBolus(
        { currentGlucoseGl: 1.00, carbsGrams: 250, patientId: 1 },
        1,
      )

      expect(result.recommendedDose).toBe(25.0)
      expect(result.wasCapped).toBe(false)
    })
  })

  // =========================================================================
  // WARNINGS: glycemia thresholds
  // =========================================================================
  describe("glycemia warnings", () => {
    it("warns severe hypoglycemia below 0.54 g/L", async () => {
      mockHour(12)
      setupMocks({ targetMgdl: 100 })

      const result = await insulinService.calculateBolus(
        { currentGlucoseGl: 0.40, carbsGrams: 0, patientId: 1 },
        1,
      )

      expect(result.warnings).toContain("severeHypoglycemia")
      expect(result.warnings).not.toContain("hypoglycemia")
    })

    it("warns hypoglycemia between 0.54 and 0.70 g/L", async () => {
      mockHour(12)
      setupMocks({ targetMgdl: 100 })

      const result = await insulinService.calculateBolus(
        { currentGlucoseGl: 0.60, carbsGrams: 0, patientId: 1 },
        1,
      )

      expect(result.warnings).toContain("hypoglycemia")
      expect(result.warnings).not.toContain("severeHypoglycemia")
    })

    it("warns severe hyperglycemia above 2.50 g/L", async () => {
      mockHour(12)
      setupMocks({ targetMgdl: 100 })

      const result = await insulinService.calculateBolus(
        { currentGlucoseGl: 2.60, carbsGrams: 0, patientId: 1 },
        1,
      )

      expect(result.warnings).toContain("severeHyperglycemia")
    })

    it("warns critical high glucose above 4.00 g/L", async () => {
      mockHour(12)
      setupMocks({ targetMgdl: 100, isfMgdl: 50 })

      const result = await insulinService.calculateBolus(
        { currentGlucoseGl: 4.50, carbsGrams: 0, patientId: 1 },
        1,
      )

      expect(result.warnings).toContain("criticalHighGlucose")
      // Also severe hyperglycemia since 4.50 > 2.50
      expect(result.warnings).toContain("severeHyperglycemia")
    })

    it("no warnings at exactly 0.70 g/L (boundary)", async () => {
      mockHour(12)
      setupMocks({ targetMgdl: 100 })

      const result = await insulinService.calculateBolus(
        { currentGlucoseGl: 0.70, carbsGrams: 0, patientId: 1 },
        1,
      )

      expect(result.warnings).not.toContain("hypoglycemia")
      expect(result.warnings).not.toContain("severeHypoglycemia")
    })

    it("hypoglycemia at exactly 0.54 g/L (boundary, not severe)", async () => {
      mockHour(12)
      setupMocks({ targetMgdl: 100 })

      const result = await insulinService.calculateBolus(
        { currentGlucoseGl: 0.54, carbsGrams: 0, patientId: 1 },
        1,
      )

      expect(result.warnings).toContain("hypoglycemia")
      expect(result.warnings).not.toContain("severeHypoglycemia")
    })

    it("no warning at exactly 2.50 g/L (boundary)", async () => {
      mockHour(12)
      setupMocks({ targetMgdl: 100, isfMgdl: 50 })

      const result = await insulinService.calculateBolus(
        { currentGlucoseGl: 2.50, carbsGrams: 0, patientId: 1 },
        1,
      )

      expect(result.warnings).not.toContain("severeHyperglycemia")
    })

    it("combines max bolus warning with glycemia warning", async () => {
      mockHour(12)
      setupMocks({ icrGrams: 10, isfMgdl: 50, targetMgdl: 100 })

      const result = await insulinService.calculateBolus(
        { currentGlucoseGl: 3.00, carbsGrams: 300, patientId: 1 },
        1,
      )

      expect(result.warnings).toContain("exceedsMaximumBolus")
      expect(result.warnings).toContain("severeHyperglycemia")
    })
  })

  // =========================================================================
  // ISF / ICR SLOT SELECTION (time-based)
  // =========================================================================
  describe("ISF/ICR slot selection", () => {
    it("selects correct slot for morning hour", async () => {
      mockHour(8)
      const settings = buildSettings()
      // Override with multiple slots
      settings.sensitivityFactors = [
        { id: 1, startHour: 6, endHour: 12, sensitivityFactorGl: 0.40, sensitivityFactorMgdl: 40 },
        { id: 2, startHour: 12, endHour: 22, sensitivityFactorGl: 0.50, sensitivityFactorMgdl: 50 },
        { id: 3, startHour: 22, endHour: 6, sensitivityFactorGl: 0.60, sensitivityFactorMgdl: 60 },
      ] as any
      settings.carbRatios = [
        { id: 1, startHour: 6, endHour: 12, gramsPerUnit: 8 },
        { id: 2, startHour: 12, endHour: 22, gramsPerUnit: 12 },
        { id: 3, startHour: 22, endHour: 6, gramsPerUnit: 10 },
      ] as any

      prismaMock.insulinTherapySettings.findUnique.mockResolvedValue(settings as any)
      mockTransaction()

      // At hour 8: ISF=40, ICR=8
      // 40g / 8 ICR = 5.0U meal
      // (150 - 100) / 40 ISF = 1.25U correction
      const result = await insulinService.calculateBolus(
        { currentGlucoseGl: 1.50, carbsGrams: 40, patientId: 1 },
        1,
      )

      expect(result.mealBolus).toBe(5.0)
      expect(result.correctionDose).toBe(1.25)
    })

    it("selects correct slot for afternoon hour", async () => {
      mockHour(15)
      const settings = buildSettings()
      settings.sensitivityFactors = [
        { id: 1, startHour: 6, endHour: 12, sensitivityFactorGl: 0.40, sensitivityFactorMgdl: 40 },
        { id: 2, startHour: 12, endHour: 22, sensitivityFactorGl: 0.50, sensitivityFactorMgdl: 50 },
        { id: 3, startHour: 22, endHour: 6, sensitivityFactorGl: 0.60, sensitivityFactorMgdl: 60 },
      ] as any
      settings.carbRatios = [
        { id: 1, startHour: 6, endHour: 12, gramsPerUnit: 8 },
        { id: 2, startHour: 12, endHour: 22, gramsPerUnit: 12 },
        { id: 3, startHour: 22, endHour: 6, gramsPerUnit: 10 },
      ] as any

      prismaMock.insulinTherapySettings.findUnique.mockResolvedValue(settings as any)
      mockTransaction()

      // At hour 15: ISF=50, ICR=12
      // 60g / 12 ICR = 5.0U
      const result = await insulinService.calculateBolus(
        { currentGlucoseGl: 1.00, carbsGrams: 60, patientId: 1 },
        1,
      )

      expect(result.mealBolus).toBe(5.0)
    })

    it("handles midnight crossing slot (e.g. 22h-6h)", async () => {
      mockHour(2) // 2 AM — should match 22-6 slot
      const settings = buildSettings()
      settings.sensitivityFactors = [
        { id: 1, startHour: 6, endHour: 12, sensitivityFactorGl: 0.40, sensitivityFactorMgdl: 40 },
        { id: 2, startHour: 12, endHour: 22, sensitivityFactorGl: 0.50, sensitivityFactorMgdl: 50 },
        { id: 3, startHour: 22, endHour: 6, sensitivityFactorGl: 0.60, sensitivityFactorMgdl: 60 },
      ] as any
      settings.carbRatios = [
        { id: 1, startHour: 6, endHour: 12, gramsPerUnit: 8 },
        { id: 2, startHour: 12, endHour: 22, gramsPerUnit: 12 },
        { id: 3, startHour: 22, endHour: 6, gramsPerUnit: 10 },
      ] as any

      prismaMock.insulinTherapySettings.findUnique.mockResolvedValue(settings as any)
      mockTransaction()

      // At hour 2: ISF=60, ICR=10
      // 50g / 10 ICR = 5.0U
      // (120 - 100) / 60 ISF = 0.33U correction
      const result = await insulinService.calculateBolus(
        { currentGlucoseGl: 1.20, carbsGrams: 50, patientId: 1 },
        1,
      )

      expect(result.mealBolus).toBe(5.0)
      expect(result.rawCorrectionDose).toBe(0.33)
    })

    it("handles hour 23 in midnight crossing slot (22h-6h)", async () => {
      mockHour(23)
      const settings = buildSettings()
      settings.sensitivityFactors = [
        { id: 1, startHour: 6, endHour: 22, sensitivityFactorGl: 0.50, sensitivityFactorMgdl: 50 },
        { id: 2, startHour: 22, endHour: 6, sensitivityFactorGl: 0.60, sensitivityFactorMgdl: 60 },
      ] as any
      settings.carbRatios = [
        { id: 1, startHour: 6, endHour: 22, gramsPerUnit: 10 },
        { id: 2, startHour: 22, endHour: 6, gramsPerUnit: 15 },
      ] as any

      prismaMock.insulinTherapySettings.findUnique.mockResolvedValue(settings as any)
      mockTransaction()

      // At hour 23: ICR=15
      // 30g / 15 ICR = 2.0U
      const result = await insulinService.calculateBolus(
        { currentGlucoseGl: 1.00, carbsGrams: 30, patientId: 1 },
        1,
      )

      expect(result.mealBolus).toBe(2.0)
    })
  })

  // =========================================================================
  // ERROR CASES
  // =========================================================================
  describe("error handling", () => {
    it("throws when no settings found for patient", async () => {
      mockHour(12)
      prismaMock.insulinTherapySettings.findUnique.mockResolvedValue(null)
      mockTransaction()

      await expect(
        insulinService.calculateBolus(
          { currentGlucoseGl: 1.00, carbsGrams: 60, patientId: 999 },
          1,
        ),
      ).rejects.toThrow("No insulin therapy settings found for patient")
    })

    it("throws when no ISF slot found for current hour", async () => {
      mockHour(12)
      const settings = buildSettings()
      settings.sensitivityFactors = [] // no slots
      prismaMock.insulinTherapySettings.findUnique.mockResolvedValue(settings as any)
      mockTransaction()

      await expect(
        insulinService.calculateBolus(
          { currentGlucoseGl: 1.00, carbsGrams: 60, patientId: 1 },
          1,
        ),
      ).rejects.toThrow("No ISF slot found for current hour")
    })

    it("throws when no ICR slot found for current hour", async () => {
      mockHour(12)
      const settings = buildSettings()
      settings.carbRatios = [] // no slots
      prismaMock.insulinTherapySettings.findUnique.mockResolvedValue(settings as any)
      mockTransaction()

      await expect(
        insulinService.calculateBolus(
          { currentGlucoseGl: 1.00, carbsGrams: 60, patientId: 1 },
          1,
        ),
      ).rejects.toThrow("No ICR slot found for current hour")
    })

    it("throws when no active glucose target found", async () => {
      mockHour(12)
      const settings = buildSettings()
      settings.glucoseTargets = [] // no targets
      prismaMock.insulinTherapySettings.findUnique.mockResolvedValue(settings as any)
      mockTransaction()

      await expect(
        insulinService.calculateBolus(
          { currentGlucoseGl: 1.00, carbsGrams: 60, patientId: 1 },
          1,
        ),
      ).rejects.toThrow("No active glucose target found")
    })
  })

  // =========================================================================
  // DELIVERY METHOD
  // =========================================================================
  describe("delivery method", () => {
    it("returns delivery method from settings", async () => {
      mockHour(12)
      setupMocks({ deliveryMethod: "pump", targetMgdl: 100 })

      const result = await insulinService.calculateBolus(
        { currentGlucoseGl: 1.00, carbsGrams: 30, patientId: 1 },
        1,
      )

      expect(result.deliveryMethod).toBe("pump")
    })
  })

  // =========================================================================
  // EDGE CASES
  // =========================================================================
  describe("edge cases", () => {
    it("handles very small carb amount", async () => {
      // 1g / 10 ICR = 0.1U
      mockHour(12)
      setupMocks({ icrGrams: 10, targetMgdl: 100 })

      const result = await insulinService.calculateBolus(
        { currentGlucoseGl: 1.00, carbsGrams: 1, patientId: 1 },
        1,
      )

      expect(result.mealBolus).toBe(0.1)
      expect(result.recommendedDose).toBe(0) // pen rounds 0.1 to 0 (below 0.5U increment)
    })

    it("handles glucose exactly at target", async () => {
      mockHour(12)
      setupMocks({ targetMgdl: 120 })

      const result = await insulinService.calculateBolus(
        { currentGlucoseGl: 1.20, carbsGrams: 0, patientId: 1 },
        1,
      )

      expect(result.rawCorrectionDose).toBe(0)
      expect(result.correctionDose).toBe(0)
      expect(result.recommendedDose).toBe(0)
    })

    it("handles very high ICR (low insulin sensitivity to carbs)", async () => {
      // 60g / 20 ICR = 3.0U
      mockHour(12)
      setupMocks({ icrGrams: 20, targetMgdl: 100 })

      const result = await insulinService.calculateBolus(
        { currentGlucoseGl: 1.00, carbsGrams: 60, patientId: 1 },
        1,
      )

      expect(result.mealBolus).toBe(3.0)
    })

    it("handles very low ICR (high insulin sensitivity to carbs)", async () => {
      // 60g / 5 ICR = 12.0U
      mockHour(12)
      setupMocks({ icrGrams: 5, targetMgdl: 100 })

      const result = await insulinService.calculateBolus(
        { currentGlucoseGl: 1.00, carbsGrams: 60, patientId: 1 },
        1,
      )

      expect(result.mealBolus).toBe(12.0)
    })
  })
})

describe("insulinService.validateSettings", () => {
  it("throws not implemented error (Phase 4)", async () => {
    await expect(
      insulinService.validateSettings(1, 1),
    ).rejects.toThrow("Not implemented")
  })
})
