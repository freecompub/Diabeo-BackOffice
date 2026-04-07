/**
 * @vitest-environment jsdom
 */

/**
 * Tests for Phase 11 widget components: DataSummaryGrid, AverageGlucoseWidget,
 * TimeInRangeWidget, HbA1cWidget.
 *
 * Clinical safety context: these widgets display aggregated CGM metrics that
 * directly inform clinical decisions. Incorrect color coding (e.g., showing
 * green for an HbA1c of 9%) or missing data (e.g., omitting hypo events)
 * could lead to inadequate treatment adjustments.
 *
 * Color thresholds tested against clinical consensus:
 * - Average glucose: green <=180, amber 181-250, red >250 mg/dL
 * - TIR: green >=70%, amber 50-69%, red <50%
 * - HbA1c: green <7.0%, amber 7.0-8.5%, red >8.5%
 */

import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

import { AverageGlucoseWidget } from "@/components/diabeo/widgets/AverageGlucoseWidget"
import { TimeInRangeWidget } from "@/components/diabeo/widgets/TimeInRangeWidget"
import { HbA1cWidget } from "@/components/diabeo/widgets/HbA1cWidget"
import { DataSummaryGrid } from "@/components/diabeo/widgets/DataSummaryGrid"
import type { WidgetData } from "@/components/diabeo/widgets/types"

// ─── AverageGlucoseWidget ────────────────────────────────────────────────────

describe("AverageGlucoseWidget", () => {
  it("renders the value", () => {
    render(<AverageGlucoseWidget value={142} unit="mg/dL" />)
    expect(screen.getByText("142")).toBeTruthy()
  })

  it("renders the unit", () => {
    render(<AverageGlucoseWidget value={142} unit="mg/dL" />)
    expect(screen.getByText("mg/dL")).toBeTruthy()
  })

  it("renders the translated label", () => {
    render(<AverageGlucoseWidget value={142} unit="mg/dL" />)
    // mock returns "metrics.averageGlucose"
    expect(screen.getByText("metrics.averageGlucose")).toBeTruthy()
  })

  it("has an aria-label with label, value, and unit", () => {
    render(<AverageGlucoseWidget value={142} unit="mg/dL" />)
    expect(
      screen.getByLabelText("metrics.averageGlucose: 142 mg/dL")
    ).toBeTruthy()
  })

  it("applies green color class for in-range value (<=180)", () => {
    const { container } = render(
      <AverageGlucoseWidget value={150} unit="mg/dL" />
    )
    const valueParagraph = container.querySelector(".text-glycemia-normal")
    expect(valueParagraph).toBeTruthy()
  })

  it("applies amber color class for elevated value (181-250)", () => {
    const { container } = render(
      <AverageGlucoseWidget value={200} unit="mg/dL" />
    )
    const valueParagraph = container.querySelector(".text-glycemia-high")
    expect(valueParagraph).toBeTruthy()
  })

  it("applies red color class for high value (>250)", () => {
    const { container } = render(
      <AverageGlucoseWidget value={300} unit="mg/dL" />
    )
    const valueParagraph = container.querySelector(".text-glycemia-very-high")
    expect(valueParagraph).toBeTruthy()
  })

  it("uses valueMgdl for color classification when provided", () => {
    // Display value is 1.42 g/L but classification should use 142 mg/dL
    const { container } = render(
      <AverageGlucoseWidget value={1.42} unit="g/L" valueMgdl={142} />
    )
    const valueParagraph = container.querySelector(".text-glycemia-normal")
    expect(valueParagraph).toBeTruthy()
  })

  it("shows loading skeleton when loading is true", () => {
    render(<AverageGlucoseWidget value={142} unit="mg/dL" loading />)
    expect(screen.getByLabelText("Chargement du widget")).toBeTruthy()
  })

  it("does not show value when loading", () => {
    render(<AverageGlucoseWidget value={142} unit="mg/dL" loading />)
    expect(screen.queryByText("142")).toBeNull()
  })

  it("is clickable when onClick is provided", () => {
    const handleClick = vi.fn()
    render(
      <AverageGlucoseWidget value={142} unit="mg/dL" onClick={handleClick} />
    )
    fireEvent.click(screen.getByRole("button"))
    expect(handleClick).toHaveBeenCalledOnce()
  })

  it("has no button role when onClick is not provided", () => {
    render(<AverageGlucoseWidget value={142} unit="mg/dL" />)
    expect(screen.queryByRole("button")).toBeNull()
  })
})

// ─── TimeInRangeWidget ───────────────────────────────────────────────────────

describe("TimeInRangeWidget", () => {
  const defaultProps = {
    inRange: 72,
    low: 8,
    veryLow: 2,
    high: 15,
    veryHigh: 3,
  }

  it("renders the in-range percentage", () => {
    render(<TimeInRangeWidget {...defaultProps} />)
    expect(screen.getByText("72")).toBeTruthy()
  })

  it("renders the percentage sign", () => {
    render(<TimeInRangeWidget {...defaultProps} />)
    expect(screen.getByText("%")).toBeTruthy()
  })

  it("has aria-label with percentage", () => {
    render(<TimeInRangeWidget {...defaultProps} />)
    expect(
      screen.getByLabelText(/metrics\.timeInRange: 72%/)
    ).toBeTruthy()
  })

  it("applies green color class for good TIR (>=70%)", () => {
    const { container } = render(
      <TimeInRangeWidget {...defaultProps} inRange={75} />
    )
    expect(container.querySelector(".text-glycemia-normal")).toBeTruthy()
  })

  it("applies amber color class for moderate TIR (50-69%)", () => {
    const { container } = render(
      <TimeInRangeWidget {...defaultProps} inRange={60} />
    )
    expect(container.querySelector(".text-glycemia-high")).toBeTruthy()
  })

  it("applies red color class for poor TIR (<50%)", () => {
    const { container } = render(
      <TimeInRangeWidget {...defaultProps} inRange={40} />
    )
    expect(container.querySelector(".text-glycemia-low")).toBeTruthy()
  })

  it("shows reading count when provided", () => {
    render(<TimeInRangeWidget {...defaultProps} readingCount={2880} />)
    expect(screen.getByText(/2880/)).toBeTruthy()
  })

  it("does not show reading count when not provided", () => {
    render(<TimeInRangeWidget {...defaultProps} />)
    expect(screen.queryByText(/metrics\.readings/)).toBeNull()
  })

  it("renders the stacked bar chart", () => {
    const { container } = render(<TimeInRangeWidget {...defaultProps} />)
    // The stacked bar has role="img"
    const bar = container.querySelector("[role='img']")
    expect(bar).toBeTruthy()
  })

  it("stacked bar has accessible label with all zone percentages", () => {
    const { container } = render(<TimeInRangeWidget {...defaultProps} />)
    const bar = container.querySelector("[role='img']")
    expect(bar?.getAttribute("aria-label")).toContain("72%")
  })

  it("shows loading skeleton when loading is true", () => {
    render(<TimeInRangeWidget {...defaultProps} loading />)
    expect(screen.getByLabelText("Chargement du widget")).toBeTruthy()
  })
})

// ─── HbA1cWidget ─────────────────────────────────────────────────────────────

describe("HbA1cWidget", () => {
  it("renders the value with one decimal place", () => {
    render(<HbA1cWidget value={7.2} />)
    expect(screen.getByText("7.2")).toBeTruthy()
  })

  it("renders the percentage sign", () => {
    render(<HbA1cWidget value={7.2} />)
    expect(screen.getByText("%")).toBeTruthy()
  })

  it("renders 'estimated' label (i18n key)", () => {
    render(<HbA1cWidget value={7.2} />)
    // i18n mock returns the key: metrics.estimated
    expect(screen.getByText("metrics.estimated")).toBeTruthy()
  })

  it("has aria-label with value", () => {
    render(<HbA1cWidget value={7.2} />)
    expect(screen.getByLabelText("metrics.hba1c: 7.2%")).toBeTruthy()
  })

  it("applies green color class for well-controlled (<7.0%)", () => {
    const { container } = render(<HbA1cWidget value={6.5} />)
    expect(container.querySelector(".text-glycemia-normal")).toBeTruthy()
  })

  it("applies amber color class for moderate control (7.0-8.5%)", () => {
    const { container } = render(<HbA1cWidget value={7.5} />)
    expect(container.querySelector(".text-glycemia-high")).toBeTruthy()
  })

  it("applies red color class for poor control (>8.5%)", () => {
    const { container } = render(<HbA1cWidget value={9.0} />)
    expect(container.querySelector(".text-glycemia-very-high")).toBeTruthy()
  })

  it("applies green at boundary (6.9%)", () => {
    const { container } = render(<HbA1cWidget value={6.9} />)
    expect(container.querySelector(".text-glycemia-normal")).toBeTruthy()
  })

  it("applies amber at boundary (7.0%)", () => {
    const { container } = render(<HbA1cWidget value={7.0} />)
    expect(container.querySelector(".text-glycemia-high")).toBeTruthy()
  })

  it("applies amber at boundary (8.5%)", () => {
    const { container } = render(<HbA1cWidget value={8.5} />)
    expect(container.querySelector(".text-glycemia-high")).toBeTruthy()
  })

  it("applies red at boundary (8.6%)", () => {
    const { container } = render(<HbA1cWidget value={8.6} />)
    expect(container.querySelector(".text-glycemia-very-high")).toBeTruthy()
  })

  it("shows loading skeleton when loading is true", () => {
    render(<HbA1cWidget value={7.2} loading />)
    expect(screen.getByLabelText("Chargement du widget")).toBeTruthy()
  })

  it("does not show value when loading", () => {
    render(<HbA1cWidget value={7.2} loading />)
    expect(screen.queryByText("7.2")).toBeNull()
  })

  it("is clickable when onClick is provided", () => {
    const handleClick = vi.fn()
    render(<HbA1cWidget value={7.2} onClick={handleClick} />)
    fireEvent.click(screen.getByRole("button"))
    expect(handleClick).toHaveBeenCalledOnce()
  })
})

// ─── DataSummaryGrid ─────────────────────────────────────────────────────────

describe("DataSummaryGrid", () => {
  const fullData: WidgetData = {
    averageGlucose: { value: 142, unit: "mg/dL" },
    hba1c: { value: 7.2 },
    hypoglycemia: { count: 3 },
    timeInRange: {
      inRange: 72,
      low: 8,
      veryLow: 2,
      high: 15,
      veryHigh: 3,
    },
    cv: { value: 32 },
    standardDeviation: { value: 45, unit: "mg/dL" },
  }

  it("renders with role=region", () => {
    render(<DataSummaryGrid data={fullData} />)
    expect(screen.getByRole("region")).toBeTruthy()
  })

  it("has accessible region label", () => {
    render(<DataSummaryGrid data={fullData} />)
    expect(
      screen.getByLabelText("metrics.resumeMetrics")
    ).toBeTruthy()
  })

  it("renders 6 widgets when all data is provided", () => {
    const { container } = render(<DataSummaryGrid data={fullData} />)
    // Each widget renders in a rounded-lg container
    const grid = container.querySelector(".grid")
    expect(grid).toBeTruthy()
    // The grid should have 6 tooltip trigger children wrapping 6 widgets
    const gridChildren = grid?.children
    expect(gridChildren?.length).toBe(6)
  })

  it("renders section title when showTitle is true", () => {
    render(<DataSummaryGrid data={fullData} showTitle />)
    expect(screen.getByText("metrics.dataCapture")).toBeTruthy()
  })

  it("does not render title when showTitle is false (default)", () => {
    render(<DataSummaryGrid data={fullData} />)
    expect(screen.queryByText("metrics.dataCapture")).toBeNull()
  })

  it("shows loading skeletons when loading is true", () => {
    render(<DataSummaryGrid data={{}} loading />)
    const skeletons = screen.getAllByLabelText("Chargement du widget")
    expect(skeletons.length).toBe(6)
  })

  it("calls onMetricTapped when a widget is clicked", () => {
    const handleTap = vi.fn()
    render(
      <DataSummaryGrid data={fullData} onMetricTapped={handleTap} />
    )
    // Find the average glucose widget by its aria-label and click it
    const avgWidget = screen.getByLabelText(
      "metrics.averageGlucose: 142 mg/dL"
    )
    fireEvent.click(avgWidget)
    expect(handleTap).toHaveBeenCalledWith("averageGlucose")
  })
})
