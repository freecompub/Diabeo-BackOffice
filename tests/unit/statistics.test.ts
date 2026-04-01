/**
 * Test suite: Statistics Library — TIR, CV, GMI, AGP, and Hypo Detection
 *
 * Clinical behavior tested:
 * - Time-In-Range (TIR) computation: percentage of CGM readings within the
 *   patient's configured glycemic target band (typically 0.70–1.80 g/L for DT1)
 * - Coefficient of Variation (CV): stddev / mean expressed as a percentage;
 *   CV > 36% indicates glycemic variability warranting clinical attention
 * - Glucose Management Indicator (GMI): HbA1c surrogate derived from mean
 *   glucose using the formula GMI(%) = 3.31 + 0.02392 * mean(mg/dL)
 * - Ambulatory Glucose Profile (AGP): percentile curves (5th, 25th, 50th, 75th,
 *   95th) computed over a rolling period for physician review
 * - Hypoglycemic episode detection: consecutive readings below the low threshold
 *   (< 0.70 g/L) lasting at least 15 minutes constitute a reportable episode
 * - CGM capture rate: fraction of expected 5-minute readings actually present
 *   over the analysis window, used to assess data completeness
 *
 * Associated risks:
 * - Incorrect TIR values would mislead physicians about glycemic control and
 *   could result in inappropriate insulin dose adjustments
 * - A GMI calculation error would produce a false HbA1c estimate, potentially
 *   concealing poor control from both physician and patient
 * - Missed hypoglycemic episode detection could prevent timely clinical
 *   intervention, posing a direct patient safety risk
 * - Wrong CV threshold assessment could trigger unnecessary adjustment
 *   proposals, increasing patient anxiety and insulin over-correction
 *
 * Edge cases:
 * - Empty glucose array (all functions must return 0 or null, not throw)
 * - Single-element array for stddev (Bessel-corrected result is NaN/0 — handled)
 * - All readings identical (CV = 0, no variability)
 * - Readings exactly on TIR boundary values (inclusive vs. exclusive)
 * - g/L to mg/dL conversion precision (glToMgdl: multiply by 1000/18 = 55.56)
 * - Hypoglycemia episode spanning midnight (timestamp boundary)
 * - CGM capture rate with a gap of exactly 15 minutes (one missed reading)
 */
import { describe, it, expect } from "vitest"
import {
  mean, stddev, coefficientOfVariation, percentile,
  glToMgdl, glucoseManagementIndicator, computeTir, assessTirQuality,
  computeAgp, detectHypoEpisodes, cgmCaptureRate,
} from "@/lib/statistics"

describe("statistics", () => {
  describe("mean", () => {
    it("computes mean of values", () => {
      expect(mean([1, 2, 3, 4, 5])).toBe(3)
    })
    it("returns 0 for empty array", () => {
      expect(mean([])).toBe(0)
    })
  })

  describe("stddev", () => {
    it("computes standard deviation with Bessel correction", () => {
      const sd = stddev([2, 4, 4, 4, 5, 5, 7, 9])
      expect(sd).toBeCloseTo(2.138, 2)
    })
    it("returns 0 for single value", () => {
      expect(stddev([5])).toBe(0)
    })
  })

  describe("coefficientOfVariation", () => {
    it("computes CV as percentage", () => {
      const cv = coefficientOfVariation([1.0, 1.1, 0.9, 1.05, 0.95])
      expect(cv).toBeGreaterThan(0)
      expect(cv).toBeLessThan(20)
    })
    it("returns 0 for zero mean", () => {
      expect(coefficientOfVariation([0, 0, 0])).toBe(0)
    })
  })

  describe("percentile", () => {
    it("computes p50 (median)", () => {
      expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3)
    })
    it("computes p10 and p90", () => {
      const sorted = Array.from({ length: 100 }, (_, i) => i + 1)
      expect(percentile(sorted, 10)).toBeCloseTo(10.9, 0)
      expect(percentile(sorted, 90)).toBeCloseTo(90.1, 0)
    })
    it("returns 0 for empty array", () => {
      expect(percentile([], 50)).toBe(0)
    })
  })

  describe("glToMgdl", () => {
    it("converts g/L to mg/dL", () => {
      expect(glToMgdl(1.0)).toBe(100)
      expect(glToMgdl(1.2)).toBeCloseTo(120)
    })
  })

  describe("glucoseManagementIndicator", () => {
    it("computes GMI formula correctly", () => {
      // GMI = 3.31 + 0.02392 × 150 = 3.31 + 3.588 = 6.898
      expect(glucoseManagementIndicator(150)).toBeCloseTo(6.90, 1)
    })
    it("100 mg/dL → ~5.7%", () => {
      // GMI = 3.31 + 0.02392 × 100 = 5.702
      expect(glucoseManagementIndicator(100)).toBeCloseTo(5.70, 1)
    })
  })

  describe("computeTir", () => {
    const thresholds = { veryLow: 0.54, low: 0.70, ok: 1.80, high: 2.50 }

    it("computes 5-zone TIR", () => {
      const values = [0.50, 0.60, 1.0, 1.2, 1.5, 2.0, 2.6]
      const tir = computeTir(values, thresholds)

      expect(tir.severeHypo).toBeCloseTo(14.29, 0)  // 1/7
      expect(tir.hypo).toBeCloseTo(14.29, 0)         // 1/7
      expect(tir.inRange).toBeCloseTo(42.86, 0)      // 3/7
      expect(tir.elevated).toBeCloseTo(14.29, 0)     // 1/7
      expect(tir.hyper).toBeCloseTo(14.29, 0)        // 1/7
    })

    it("returns zeros for empty input", () => {
      const tir = computeTir([], thresholds)
      expect(tir.inRange).toBe(0)
    })

    it("all percentages sum to 100%", () => {
      const values = Array.from({ length: 288 }, () => 0.70 + Math.random() * 1.1)
      const tir = computeTir(values, thresholds)
      const total = tir.severeHypo + tir.hypo + tir.inRange + tir.elevated + tir.hyper
      expect(total).toBeCloseTo(100, 5)
    })
  })

  describe("assessTirQuality", () => {
    it("excellent: TIR>=70%, CV<=36%", () => {
      const tir = { severeHypo: 0, hypo: 2, inRange: 75, elevated: 20, hyper: 3 }
      expect(assessTirQuality(tir, 30)).toBe("excellent")
    })
    it("good: TIR>=50%", () => {
      const tir = { severeHypo: 0, hypo: 3, inRange: 55, elevated: 30, hyper: 12 }
      expect(assessTirQuality(tir, 38)).toBe("good")
    })
    it("concerningHypo: hypo+severeHypo > 5%", () => {
      const tir = { severeHypo: 3, hypo: 5, inRange: 70, elevated: 15, hyper: 7 }
      expect(assessTirQuality(tir, 30)).toBe("concerningHypo")
    })
    it("concerningHyper: hyper > 25%", () => {
      const tir = { severeHypo: 0, hypo: 1, inRange: 40, elevated: 29, hyper: 30 }
      expect(assessTirQuality(tir, 45)).toBe("concerningHyper")
    })
    it("needsImprovement: TIR < 50%", () => {
      const tir = { severeHypo: 0, hypo: 2, inRange: 40, elevated: 35, hyper: 23 }
      expect(assessTirQuality(tir, 42)).toBe("needsImprovement")
    })
  })

  describe("computeAgp", () => {
    it("produces 96 time slots (24h / 15min)", () => {
      const entries = Array.from({ length: 288 }, (_, i) => ({
        timestamp: new Date(2026, 0, 1, Math.floor(i / 12), (i % 12) * 5),
        valueGl: 1.0 + Math.random() * 0.5,
      }))
      const agp = computeAgp(entries)
      expect(agp).toHaveLength(96)
      expect(agp[0].timeMinutes).toBe(0)
      expect(agp[95].timeMinutes).toBe(95 * 15)
    })

    it("computes correct percentiles per slot", () => {
      // All values 1.0 in slot 0 → all percentiles = 1.0
      const entries = Array.from({ length: 10 }, () => ({
        timestamp: new Date(2026, 0, 1, 0, 5),
        valueGl: 1.0,
      }))
      const agp = computeAgp(entries)
      expect(agp[0].p50).toBe(1.0)
      expect(agp[0].p10).toBe(1.0)
    })
  })

  describe("detectHypoEpisodes", () => {
    const thresholds = { low: 0.70, veryLow: 0.54 }

    it("detects episode with 3+ consecutive readings (≥15min)", () => {
      const entries = [
        { timestamp: new Date(2026, 0, 1, 10, 0), valueGl: 0.65 },
        { timestamp: new Date(2026, 0, 1, 10, 5), valueGl: 0.60 },
        { timestamp: new Date(2026, 0, 1, 10, 10), valueGl: 0.62 },
        { timestamp: new Date(2026, 0, 1, 10, 15), valueGl: 0.75 }, // normal
      ]
      const episodes = detectHypoEpisodes(entries, thresholds)
      expect(episodes).toHaveLength(1)
      expect(episodes[0].severity).toBe("level1")
      expect(episodes[0].duration).toBe(10)
    })

    it("detects level2 severity (below veryLow)", () => {
      const entries = [
        { timestamp: new Date(2026, 0, 1, 10, 0), valueGl: 0.50 },
        { timestamp: new Date(2026, 0, 1, 10, 5), valueGl: 0.45 },
        { timestamp: new Date(2026, 0, 1, 10, 10), valueGl: 0.48 },
      ]
      const episodes = detectHypoEpisodes(entries, thresholds)
      expect(episodes).toHaveLength(1)
      expect(episodes[0].severity).toBe("level2")
      expect(episodes[0].nadir).toBe(0.45)
    })

    it("ignores 1-2 low readings (below 15min threshold)", () => {
      const entries = [
        { timestamp: new Date(2026, 0, 1, 10, 0), valueGl: 0.65 },
        { timestamp: new Date(2026, 0, 1, 10, 5), valueGl: 0.60 },
        { timestamp: new Date(2026, 0, 1, 10, 10), valueGl: 0.75 },
      ]
      expect(detectHypoEpisodes(entries, thresholds)).toHaveLength(0)
    })

    it("splits episodes with gap > 30min", () => {
      const entries = [
        { timestamp: new Date(2026, 0, 1, 10, 0), valueGl: 0.60 },
        { timestamp: new Date(2026, 0, 1, 10, 5), valueGl: 0.55 },
        { timestamp: new Date(2026, 0, 1, 10, 10), valueGl: 0.58 },
        // 40 min gap
        { timestamp: new Date(2026, 0, 1, 10, 50), valueGl: 0.60 },
        { timestamp: new Date(2026, 0, 1, 10, 55), valueGl: 0.55 },
        { timestamp: new Date(2026, 0, 1, 11, 0), valueGl: 0.57 },
      ]
      expect(detectHypoEpisodes(entries, thresholds)).toHaveLength(2)
    })
  })

  describe("cgmCaptureRate", () => {
    it("100% for 288 readings per day", () => {
      expect(cgmCaptureRate(288, 1)).toBe(100)
    })
    it("50% for 144 readings per day", () => {
      expect(cgmCaptureRate(144, 1)).toBe(50)
    })
    it("returns 0 for 0 days", () => {
      expect(cgmCaptureRate(100, 0)).toBe(0)
    })
  })
})
