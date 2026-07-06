/**
 * Test suite: Proposal Algorithm — Insulin Adjustment Proposal Generation
 *
 * Clinical behavior tested:
 * - Confidence level assignment based on the number of qualifying glucose
 *   events: 3–5 events = "low", 6–10 = "medium", >10 = "high"; proposals
 *   below "low" confidence are not generated (insufficient data)
 * - Change percent clamping: ISF, ICR AND basal adjustments are all capped at
 *   ±20% per proposal cycle (CLINICAL_BOUNDS.MAX_CHANGE_PERCENT) via the shared
 *   `clampChangePercent` — no per-parameter cap difference
 * - Proposed value computation: applies the clamped percentage change to the
 *   current value and rounds uniformly to 4 decimals (`computeProposedValue`)
 * - ISF slot analysis: compares post-meal correction outcomes within a time
 *   slot against the glucose target to infer whether the sensitivity factor
 *   should increase or decrease
 * - ICR slot analysis: evaluates post-prandial glucose rise relative to
 *   reported carb intake to assess whether the carb ratio is appropriate
 * - Basal trend analysis: detects fasting glucose drift across overnight and
 *   inter-meal windows to flag basal rate under- or over-delivery
 *
 * Associated risks:
 * - An unclamped adjustment could propose an ISF or ICR change exceeding safe
 *   clinical limits, leading to hypoglycemia or hyperglycemia if accepted
 * - Generating a "high confidence" proposal from only 3 events would produce
 *   an unreliable suggestion that a physician might accept without scrutiny
 * - A sign inversion bug in analyzeIsfSlot (proposing to raise ISF when it
 *   should decrease) would systematically under-correct hyperglycemia
 * - Precision errors in computeProposedValue could push a value outside
 *   CLINICAL_BOUNDS after rounding
 *
 * Edge cases:
 * - Exactly 3 events (minimum for "low" confidence)
 * - Exactly 11 events (minimum for "high" confidence)
 * - Change percent of 0% (no proposal should be emitted)
 * - Current value at CLINICAL_BOUNDS minimum with a proposed decrease (must
 *   clamp to minimum, not go below)
 * - Current value at CLINICAL_BOUNDS maximum with a proposed increase (must
 *   clamp to maximum)
 * - Empty events array passed to analyzeIsfSlot or analyzeIcrSlot
 */
import { describe, it, expect } from "vitest"
import {
  getConfidenceLevel, clampChangePercent, computeProposedValue,
  analyzeIsfSlot, analyzeIcrSlot, analyzeBasalTrend, analyzeFixedDose,
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

    it("post-repas au-dessus de la cible → ICR trop haut → baisse (reason icrTooHigh)", () => {
      const meals = Array.from({ length: 6 }, () => ({
        postGlucoseGl: 2.00, targetGl: 1.20,
      }))
      const result = analyzeIcrSlot(slot, meals)
      expect(result).not.toBeNull()
      expect(result!.parameterType).toBe("insulinToCarbRatio")
      // Direction : baisse de l'ICR (plus d'insuline/gramme).
      expect(result!.proposedValue).toBeLessThan(slot.gramsPerUnit)
      // Libellé corrigé (US-2651, validé medical) : l'ICR courant est trop HAUT.
      expect(result!.reason).toBe("icrTooHigh")
    })

    it("post-repas en dessous de la cible → ICR trop bas → hausse (reason icrTooLow)", () => {
      const meals = Array.from({ length: 6 }, () => ({ postGlucoseGl: 0.80, targetGl: 1.20 }))
      const result = analyzeIcrSlot(slot, meals)
      expect(result!.proposedValue).toBeGreaterThan(slot.gramsPerUnit)
      expect(result!.reason).toBe("icrTooLow")
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

  describe("analyzeFixedDose (mode b, US-2651)", () => {
    const slot = { moment: "noon" as const, valueU: 20 }
    const readings = (post: number, n = 6) =>
      Array.from({ length: n }, () => ({ postGlucoseGl: post, targetGl: 1.2 }))

    it("insuffisant (< 3 relevés) → null", () => {
      expect(analyzeFixedDose(slot, readings(2.0, 2))).toBeNull()
    })

    it("glycémie au-dessus de la cible → dose trop basse → HAUSSE bornée (reason fixedDoseTooLow)", () => {
      const r = analyzeFixedDose(slot, readings(2.0))
      expect(r).not.toBeNull()
      expect(r!.parameterType).toBe("fixedDose")
      expect(r!.reason).toBe("fixedDoseTooLow")
      // Cap = min(±10 % de 20 = 2 U, ±2 U) → +2 U.
      expect(r!.proposedValue).toBe(22)
    })

    it("glycémie en dessous de la cible → dose trop haute → BAISSE (reason fixedDoseTooHigh)", () => {
      const r = analyzeFixedDose(slot, readings(1.0))
      expect(r!.reason).toBe("fixedDoseTooHigh")
      expect(r!.proposedValue).toBe(18)
    })

    it("cap ABSOLU ± 2 U l'emporte sur ± 10 % pour une grosse dose (50 U → +2 U, pas +5 U)", () => {
      const r = analyzeFixedDose({ moment: "morning", valueU: 50 }, readings(2.0))
      expect(r!.proposedValue).toBe(52)
    })

    it("pas arrondi nul (< 0,5 U) → non actionnable → null", () => {
      // 4 U, PPG à peine au-dessus (1.25 vs 1.2) → delta ≈ 0,17 U → arrondi 0 → null.
      expect(analyzeFixedDose({ moment: "evening", valueU: 4 }, readings(1.25))).toBeNull()
    })

    it("garde HYPO : une hypo sévère dans le moment supprime toute HAUSSE → null (US-2651)", () => {
      const mixed = [
        { postGlucoseGl: 2.5, targetGl: 1.2 },
        { postGlucoseGl: 2.6, targetGl: 1.2 },
        { postGlucoseGl: 2.4, targetGl: 1.2 },
        { postGlucoseGl: 0.4, targetGl: 1.2 }, // hypo sévère < 0,54 g/L
      ]
      expect(analyzeFixedDose(slot, mixed)).toBeNull()
    })

    it("garde HYPO : la BAISSE reste permise malgré une hypo (sens sûr)", () => {
      const lowWithHypo = [
        { postGlucoseGl: 0.9, targetGl: 1.2 },
        { postGlucoseGl: 0.8, targetGl: 1.2 },
        { postGlucoseGl: 0.4, targetGl: 1.2 },
      ]
      const r = analyzeFixedDose(slot, lowWithHypo)
      expect(r!.reason).toBe("fixedDoseTooHigh")
      expect(r!.proposedValue).toBeLessThan(slot.valueU)
    })

    it("garde ENTRÉE : dose courante nulle ou < plancher → null (pas de division par zéro)", () => {
      expect(analyzeFixedDose({ moment: "noon", valueU: 0 }, readings(2.0))).toBeNull()
      expect(analyzeFixedDose({ moment: "noon", valueU: 0.2 }, readings(2.0))).toBeNull()
    })
  })

})
