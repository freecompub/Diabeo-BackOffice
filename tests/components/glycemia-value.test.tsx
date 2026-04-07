/**
 * @vitest-environment jsdom
 */

/**
 * Tests for GlycemiaValue component.
 *
 * Clinical safety context: this component displays glucose values with
 * color-coded zones (very-low, low, normal, high, very-high, critical).
 * A rendering bug could display a critical hypoglycemia (52 mg/dL) as
 * "normal", misleading the clinician. These tests verify that every
 * clinical threshold renders the correct zone and ARIA label.
 */

import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { GlycemiaValue, getGlycemiaZone } from "@/components/diabeo"

describe("GlycemiaValue", () => {
  describe("getGlycemiaZone — clinical threshold classification", () => {
    it("classifies < 54 mg/dL as very-low (severe hypoglycemia)", () => {
      expect(getGlycemiaZone(40)).toBe("very-low")
      expect(getGlycemiaZone(53)).toBe("very-low")
    })

    it("classifies 54-69 mg/dL as low (hypoglycemia)", () => {
      expect(getGlycemiaZone(54)).toBe("low")
      expect(getGlycemiaZone(69)).toBe("low")
    })

    it("classifies 70-180 mg/dL as normal (in range)", () => {
      expect(getGlycemiaZone(70)).toBe("normal")
      expect(getGlycemiaZone(120)).toBe("normal")
      expect(getGlycemiaZone(180)).toBe("normal")
    })

    it("classifies 181-250 mg/dL as high (hyperglycemia)", () => {
      expect(getGlycemiaZone(181)).toBe("high")
      expect(getGlycemiaZone(250)).toBe("high")
    })

    it("classifies 251-400 mg/dL as very-high (severe hyperglycemia)", () => {
      expect(getGlycemiaZone(251)).toBe("very-high")
      expect(getGlycemiaZone(400)).toBe("very-high")
    })

    it("classifies > 400 mg/dL as critical", () => {
      expect(getGlycemiaZone(401)).toBe("critical")
      expect(getGlycemiaZone(500)).toBe("critical")
    })

    it("respects custom thresholds", () => {
      const gdThresholds = { low: 63, high: 140, veryHigh: 200 }
      expect(getGlycemiaZone(65, gdThresholds)).toBe("normal") // 63-140 = normal for GD
      expect(getGlycemiaZone(141, gdThresholds)).toBe("high")
    })
  })

  describe("rendering", () => {
    it("renders glucose value in mg/dL", () => {
      render(<GlycemiaValue value={120} />)
      expect(screen.getByText("120")).toBeTruthy()
    })

    it("renders glucose value in g/L", () => {
      render(<GlycemiaValue value={120} unit="g/L" showUnit />)
      expect(screen.getByText("1.20")).toBeTruthy()
    })

    it("renders glucose value in mmol/L", () => {
      render(<GlycemiaValue value={120} unit="mmol/L" showUnit />)
      expect(screen.getByText("6.7")).toBeTruthy()
    })

    it("renders zone label when showZoneLabel is true", () => {
      render(<GlycemiaValue value={50} showZoneLabel />)
      // i18n mock returns key path: glycemia.zone.veryLow
      expect(screen.getByText(/glycemia\.zone\.veryLow/)).toBeTruthy()
    })

    it("has correct ARIA label for hypo", () => {
      const { container } = render(<GlycemiaValue value={60} />)
      const el = container.querySelector("[aria-label]")
      // i18n mock returns key: glycemia.zone.low
      expect(el?.getAttribute("aria-label")).toContain("glycemia.zone.low")
    })

    it("has correct ARIA label for critical", () => {
      const { container } = render(<GlycemiaValue value={450} />)
      const el = container.querySelector("[aria-label]")
      expect(el?.getAttribute("aria-label")).toContain("glycemia.zone.critical")
    })
  })
})
