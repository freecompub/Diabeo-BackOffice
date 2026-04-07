/**
 * @vitest-environment jsdom
 */

/**
 * Tests for getGlucoseZone() — pure function that classifies a glucose value
 * into a clinical zone based on configurable thresholds.
 *
 * Clinical safety context: incorrect zone classification directly impacts
 * color coding in the UI. A value of 53 mg/dL (severe hypoglycemia) displayed
 * as "inRange" green could delay critical treatment. Boundary values are
 * tested exhaustively because off-by-one errors here have clinical consequences.
 *
 * Default thresholds (ADA/International Consensus):
 *   veryLow  : < 54 mg/dL
 *   low      : 54–69 mg/dL
 *   inRange  : 70–180 mg/dL
 *   high     : 181–250 mg/dL
 *   veryHigh : > 250 mg/dL
 */

import { describe, it, expect } from "vitest"
import {
  getGlucoseZone,
  DEFAULT_THRESHOLDS,
} from "@/components/diabeo/charts/types"

describe("getGlucoseZone", () => {
  describe("default thresholds — critical zone (< 40 or > 400)", () => {
    it("classifies 0 as critical (extreme low)", () => {
      expect(getGlucoseZone(0)).toBe("critical")
    })

    it("classifies negative value as critical", () => {
      expect(getGlucoseZone(-10)).toBe("critical")
    })

    it("classifies 39 as critical (boundary: <40)", () => {
      expect(getGlucoseZone(39)).toBe("critical")
    })

    it("classifies 401 as critical (boundary: >400)", () => {
      expect(getGlucoseZone(401)).toBe("critical")
    })
  })

  describe("default thresholds — veryLow zone (40–53)", () => {
    it("classifies 40 as veryLow (boundary: critical/veryLow)", () => {
      expect(getGlucoseZone(40)).toBe("veryLow")
    })

    it("classifies 53 as veryLow", () => {
      expect(getGlucoseZone(53)).toBe("veryLow")
    })
  })

  describe("default thresholds — low zone (54–69)", () => {
    it("classifies 54 as low (boundary: veryLow threshold)", () => {
      expect(getGlucoseZone(54)).toBe("low")
    })

    it("classifies 69 as low", () => {
      expect(getGlucoseZone(69)).toBe("low")
    })
  })

  describe("default thresholds — inRange zone (70–180)", () => {
    it("classifies 70 as inRange (boundary: low threshold)", () => {
      expect(getGlucoseZone(70)).toBe("inRange")
    })

    it("classifies 120 as inRange (typical normal)", () => {
      expect(getGlucoseZone(120)).toBe("inRange")
    })

    it("classifies 180 as inRange (boundary: targetMax)", () => {
      expect(getGlucoseZone(180)).toBe("inRange")
    })
  })

  describe("default thresholds — high zone (181–250)", () => {
    it("classifies 181 as high (boundary: targetMax + 1)", () => {
      expect(getGlucoseZone(181)).toBe("high")
    })

    it("classifies 250 as high (boundary: high threshold)", () => {
      expect(getGlucoseZone(250)).toBe("high")
    })
  })

  describe("default thresholds — veryHigh zone (> 250)", () => {
    it("classifies 251 as veryHigh (boundary: high + 1)", () => {
      expect(getGlucoseZone(251)).toBe("veryHigh")
    })

    it("classifies 400 as veryHigh (boundary: before critical)", () => {
      expect(getGlucoseZone(400)).toBe("veryHigh")
    })

    it("classifies 600 as critical (extremely high)", () => {
      expect(getGlucoseZone(600)).toBe("critical")
    })

    it("classifies 9999 as critical (unrealistic large value)", () => {
      expect(getGlucoseZone(9999)).toBe("critical")
    })
  })

  describe("custom thresholds", () => {
    it("uses custom targetMax for zone boundary", () => {
      const custom = { ...DEFAULT_THRESHOLDS, targetMax: 160 }
      // 160 should be inRange (<=160)
      expect(getGlucoseZone(160, custom)).toBe("inRange")
      // 161 should be high (>160)
      expect(getGlucoseZone(161, custom)).toBe("high")
    })

    it("uses custom veryLow threshold", () => {
      const custom = { ...DEFAULT_THRESHOLDS, veryLow: 60, low: 80 }
      expect(getGlucoseZone(59, custom)).toBe("veryLow")
      expect(getGlucoseZone(60, custom)).toBe("low")
      expect(getGlucoseZone(79, custom)).toBe("low")
      expect(getGlucoseZone(80, custom)).toBe("inRange")
    })

    it("uses custom high threshold", () => {
      const custom = { ...DEFAULT_THRESHOLDS, high: 200 }
      expect(getGlucoseZone(200, custom)).toBe("high")
      expect(getGlucoseZone(201, custom)).toBe("veryHigh")
    })
  })

  describe("DEFAULT_THRESHOLDS constant", () => {
    it("has expected ADA consensus values", () => {
      expect(DEFAULT_THRESHOLDS).toEqual({
        criticalLow: 40,
        veryLow: 54,
        low: 70,
        targetMin: 70,
        targetMax: 180,
        high: 250,
        veryHigh: 400,
        criticalHigh: 400,
      })
    })
  })
})
