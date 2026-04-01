import { describe, it, expect } from "vitest"
import {
  getConfidenceLevel, clampChangePercent, computeProposedValue,
  analyzeIsfSlot, analyzeIcrSlot, analyzeBasalTrend,
} from "@/lib/proposal-algorithm"

describe("proposal-algorithm", () => {
  describe("getConfidenceLevel", () => {
    it("returns low for 3-5 events", () => {
      expect(getConfidenceLevel(3)).toBe("low")
      expect(getConfidenceLevel(5)).toBe("low")
    })
    it("returns medium for 6-10 events", () => {
      expect(getConfidenceLevel(6)).toBe("medium")
      expect(getConfidenceLevel(10)).toBe("medium")
    })
    it("returns high for >10 events", () => {
      expect(getConfidenceLevel(11)).toBe("high")
    })
  })

  describe("clampChangePercent", () => {
    it("clamps to ±20%", () => {
      expect(clampChangePercent(25)).toBe(20)
      expect(clampChangePercent(-30)).toBe(-20)
      expect(clampChangePercent(10)).toBe(10)
    })
  })

  describe("computeProposedValue", () => {
    it("applies clamped percentage", () => {
      expect(computeProposedValue(0.50, 10)).toBeCloseTo(0.55)
      expect(computeProposedValue(10.0, -10)).toBeCloseTo(9.0)
    })
    it("caps at ±20%", () => {
      expect(computeProposedValue(1.0, 50)).toBeCloseTo(1.2) // clamped to +20%
    })
  })

  describe("analyzeIsfSlot", () => {
    const slot = { startHour: 8, endHour: 12, sensitivityFactorGl: 0.50 }

    it("returns null with < 3 events", () => {
      expect(analyzeIsfSlot(slot, [{ postGlucoseGl: 2.0, targetGl: 1.2 }])).toBeNull()
    })

    it("proposes adjustment when post-correction glucose above target (ISF too high)", () => {
      const corrections = Array.from({ length: 8 }, () => ({
        postGlucoseGl: 1.80, targetGl: 1.20,
      }))
      const result = analyzeIsfSlot(slot, corrections)
      expect(result).not.toBeNull()
      expect(result!.reason).toBe("isfTooHigh")
      expect(result!.confidence).toBe("medium")
      expect(Math.abs(result!.changePercent)).toBeGreaterThan(0)
    })

    it("proposes adjustment when post-correction glucose below target (ISF too low)", () => {
      const corrections = Array.from({ length: 5 }, () => ({
        postGlucoseGl: 0.60, targetGl: 1.20,
      }))
      const result = analyzeIsfSlot(slot, corrections)
      expect(result).not.toBeNull()
      expect(result!.reason).toBe("isfTooLow")
    })

    it("returns null when error < 2%", () => {
      const corrections = Array.from({ length: 5 }, () => ({
        postGlucoseGl: 1.21, targetGl: 1.20,
      }))
      expect(analyzeIsfSlot(slot, corrections)).toBeNull()
    })
  })

  describe("analyzeIcrSlot", () => {
    const slot = { startHour: 12, endHour: 14, gramsPerUnit: 10 }

    it("detects high post-meal glucose (ICR too high)", () => {
      const meals = Array.from({ length: 6 }, () => ({
        postGlucoseGl: 2.00, targetGl: 1.20,
      }))
      const result = analyzeIcrSlot(slot, meals)
      expect(result).not.toBeNull()
      expect(result!.parameterType).toBe("insulinToCarbRatio")
    })

    it("returns null with insufficient data", () => {
      expect(analyzeIcrSlot(slot, [])).toBeNull()
    })
  })

  describe("analyzeBasalTrend", () => {
    it("detects fasting glucose above target (basal too low)", () => {
      const fasting = [1.50, 1.60, 1.55, 1.45, 1.58]
      const result = analyzeBasalTrend(fasting, 1.20, 0.80)
      expect(result).not.toBeNull()
      expect(result!.reason).toBe("basalTooLow")
      expect(result!.parameterType).toBe("basalRate")
    })

    it("detects fasting glucose below target (basal too high)", () => {
      const fasting = [0.60, 0.55, 0.58, 0.62]
      const result = analyzeBasalTrend(fasting, 1.20, 0.80)
      expect(result).not.toBeNull()
      expect(result!.reason).toBe("basalTooHigh")
    })

    it("returns null with < 3 values", () => {
      expect(analyzeBasalTrend([1.5], 1.2, 0.8)).toBeNull()
    })
  })
})
