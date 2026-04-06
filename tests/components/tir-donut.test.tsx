/**
 * @vitest-environment jsdom
 */

/**
 * Tests for TirDonut component.
 *
 * Clinical safety context: TIR (Time In Range) is the primary metric
 * for glycemic control. Incorrect percentage rendering could mislead
 * a clinician into thinking a patient is well-controlled when they are not.
 * Tests verify correct zone calculations and rendering.
 */

import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { TirDonut } from "@/components/diabeo"

describe("TirDonut", () => {
  const GOOD_TIR = { veryLow: 1, low: 3, inRange: 72, high: 19, veryHigh: 5 }
  const POOR_TIR = { veryLow: 5, low: 10, inRange: 35, high: 30, veryHigh: 20 }
  const EXCELLENT_TIR = { veryLow: 0, low: 2, inRange: 85, high: 10, veryHigh: 3 }

  it("renders SVG donut chart", () => {
    const { container } = render(<TirDonut data={GOOD_TIR} />)
    expect(container.querySelector("svg")).toBeTruthy()
  })

  it("renders all 5 TIR zones as circle segments", () => {
    const { container } = render(<TirDonut data={GOOD_TIR} />)
    const circles = container.querySelectorAll("circle")
    // Background circle + 5 zone circles
    expect(circles.length).toBeGreaterThanOrEqual(5)
  })

  it("shows legend with zone labels when showLegend is true", () => {
    render(<TirDonut data={GOOD_TIR} showLegend />)
    expect(screen.getByText(/Dans la cible|In Range/i)).toBeTruthy()
  })

  it("renders center label when showCenterLabel is true", () => {
    render(<TirDonut data={GOOD_TIR} showCenterLabel />)
    expect(screen.getByText("72%")).toBeTruthy()
  })

  it("accepts custom size", () => {
    const { container } = render(<TirDonut data={GOOD_TIR} size={240} />)
    const svg = container.querySelector("svg")
    expect(svg?.getAttribute("width")).toBe("240")
  })

  it("renders poor TIR correctly", () => {
    render(<TirDonut data={POOR_TIR} showCenterLabel />)
    expect(screen.getByText("35%")).toBeTruthy()
  })

  it("renders excellent TIR correctly", () => {
    render(<TirDonut data={EXCELLENT_TIR} showCenterLabel />)
    expect(screen.getByText("85%")).toBeTruthy()
  })

  it("has accessible label on SVG", () => {
    const { container } = render(<TirDonut data={GOOD_TIR} />)
    const svg = container.querySelector("svg")
    expect(
      svg?.getAttribute("role") === "img" ||
      svg?.getAttribute("aria-label") != null
    ).toBeTruthy()
  })
})
