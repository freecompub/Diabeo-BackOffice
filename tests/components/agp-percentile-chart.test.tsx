/**
 * @vitest-environment jsdom
 */

/**
 * Tests for AgpPercentileChart (US-3362).
 *
 * Clinical safety: the AGP chart visualises a 7-day glycemic distribution.
 * Showing wrong bands (e.g. swapping p10 and p25) could mislead the patient
 * about their actual glucose pattern.
 *
 * jsdom doesn't compute SVG layout, so we focus on:
 *  - empty-state rendering when slot count < minSlots
 *  - presence of chart elements (legend, recharts container) when data is valid
 */

import { describe, it, expect, vi } from "vitest"

vi.mock("next-intl", async () =>
  (await import("../helpers/nextIntlMock")).makeNextIntlMock())
import { render, screen } from "@testing-library/react"
import {
  AgpPercentileChart,
  type AgpSlotPoint,
} from "@/components/diabeo/AgpPercentileChart"

function makeSlots(count: number): AgpSlotPoint[] {
  return Array.from({ length: count }, (_, i) => ({
    timeMinutes: i * 15,
    p10: 0.7,
    p25: 0.9,
    p50: 1.1,
    p75: 1.4,
    p90: 1.8,
    count: 30,
  }))
}

describe("AgpPercentileChart", () => {
  it("renders the empty-state when slot count < minSlots", () => {
    render(<AgpPercentileChart slots={makeSlots(5)} minSlots={12} />)
    expect(screen.getByText(/Données insuffisantes/i)).toBeTruthy()
    expect(screen.getByText(/Portez le capteur de glucose en continu \(CGM\)/i)).toBeTruthy()
  })

  it("renders the chart figure when slot count >= minSlots", () => {
    render(<AgpPercentileChart slots={makeSlots(20)} minSlots={12} />)
    expect(screen.queryByText(/Données insuffisantes/i)).toBeNull()
    expect(screen.getByRole("figure")).toBeTruthy()
  })

  it("renders the percentile legend (médiane, 25-75%, 10-90%, cible)", () => {
    render(<AgpPercentileChart slots={makeSlots(20)} />)
    // Multiple occurrences expected (legend + sr-only table caption/header)
    expect(screen.getAllByText(/Médiane/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/25-75 %/i)).toBeTruthy()
    expect(screen.getByText(/10-90 %/i)).toBeTruthy()
    expect(screen.getAllByText(/70-180 mg\/dL/i).length).toBeGreaterThan(0)
  })

  it("accepts custom target range and renders it in legend", () => {
    render(
      <AgpPercentileChart
        slots={makeSlots(20)}
        targetLowMgdl={80}
        targetHighMgdl={160}
      />,
    )
    expect(screen.getAllByText(/80-160 mg\/dL/i).length).toBeGreaterThan(0)
  })

  it("C1 (re-review) — renders sr-only data table for screen readers", () => {
    const { container } = render(<AgpPercentileChart slots={makeSlots(20)} />)
    const table = container.querySelector("table.sr-only")
    expect(table).toBeTruthy()
    // 20 rows + 1 header
    expect(table?.querySelectorAll("tbody tr").length).toBe(20)
  })

  it("US-2635 — empty-state when POPULATED slots < minSlots even if length is 96", () => {
    // 96 slots (comme computeAgp) mais seulement 3 renseignés → insuffisant.
    const slots: AgpSlotPoint[] = Array.from({ length: 96 }, (_, i) => ({
      timeMinutes: i * 15, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0, count: i < 3 ? 30 : 0,
    }))
    render(<AgpPercentileChart slots={slots} minSlots={12} />)
    expect(screen.getByText(/Données insuffisantes/i)).toBeTruthy()
  })

  it("US-2635 — a slot with count=0 renders « — » in the sr-only table (no 0 mg/dL)", () => {
    const slots = makeSlots(20)
    slots[0] = { ...slots[0], count: 0 } // créneau sans relevé
    const { container } = render(<AgpPercentileChart slots={slots} />)
    const firstRow = container.querySelector("table.sr-only tbody tr")
    expect(firstRow?.textContent).toContain("—")
  })

  it("C2 (re-review) — legend swatches have aria-label", () => {
    const { container } = render(<AgpPercentileChart slots={makeSlots(20)} />)
    const labelled = container.querySelectorAll('[role="img"][aria-label]')
    expect(labelled.length).toBe(4) // 4 swatches: median, 25-75, 10-90, target
  })
})
