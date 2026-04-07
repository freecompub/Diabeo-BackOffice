/**
 * @vitest-environment jsdom
 */

/**
 * Tests for PeriodSelector component (US-WEB-102).
 *
 * Clinical safety context: the period selector controls the time window
 * for clinical data views (CGM charts, glycemia analytics). An incorrect
 * selection state could cause clinicians to review data from the wrong
 * time window, potentially missing critical trends.
 */

import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

import {
  PeriodSelector,
  TimePeriod,
} from "@/components/diabeo/PeriodSelector"

describe("PeriodSelector", () => {
  const defaultProps = {
    selectedPeriod: TimePeriod.OneMonth,
    onPeriodSelected: vi.fn(),
  }

  it("renders all 4 period buttons", () => {
    render(<PeriodSelector {...defaultProps} />)
    const tabs = screen.getAllByRole("tab")
    expect(tabs).toHaveLength(4)
  })

  it("renders i18n label keys for each period", () => {
    render(<PeriodSelector {...defaultProps} />)
    // The mock returns "period.<key>" for each label
    expect(screen.getByText("period.oneWeek")).toBeTruthy()
    expect(screen.getByText("period.twoWeeks")).toBeTruthy()
    expect(screen.getByText("period.oneMonth")).toBeTruthy()
    expect(screen.getByText("period.threeMonths")).toBeTruthy()
  })

  it("has role=tablist on the container", () => {
    render(<PeriodSelector {...defaultProps} />)
    expect(screen.getByRole("tablist")).toBeTruthy()
  })

  it("selected period has aria-selected=true", () => {
    render(
      <PeriodSelector
        selectedPeriod={TimePeriod.TwoWeeks}
        onPeriodSelected={vi.fn()}
      />
    )
    const tabs = screen.getAllByRole("tab")
    // TwoWeeks is the second tab (index 1)
    expect(tabs[1].getAttribute("aria-selected")).toBe("true")
  })

  it("non-selected periods have aria-selected=false", () => {
    render(
      <PeriodSelector
        selectedPeriod={TimePeriod.OneWeek}
        onPeriodSelected={vi.fn()}
      />
    )
    const tabs = screen.getAllByRole("tab")
    // First is selected, rest are not
    expect(tabs[0].getAttribute("aria-selected")).toBe("true")
    expect(tabs[1].getAttribute("aria-selected")).toBe("false")
    expect(tabs[2].getAttribute("aria-selected")).toBe("false")
    expect(tabs[3].getAttribute("aria-selected")).toBe("false")
  })

  it("calls onPeriodSelected when a period is clicked", () => {
    const handleSelect = vi.fn()
    render(
      <PeriodSelector
        selectedPeriod={TimePeriod.OneMonth}
        onPeriodSelected={handleSelect}
      />
    )
    const tabs = screen.getAllByRole("tab")
    // Click on 1W (first tab)
    fireEvent.click(tabs[0])
    expect(handleSelect).toHaveBeenCalledWith(TimePeriod.OneWeek)
  })

  it("calls onPeriodSelected with correct period for each button", () => {
    const handleSelect = vi.fn()
    render(
      <PeriodSelector
        selectedPeriod={TimePeriod.OneMonth}
        onPeriodSelected={handleSelect}
      />
    )
    const tabs = screen.getAllByRole("tab")

    fireEvent.click(tabs[0])
    expect(handleSelect).toHaveBeenCalledWith(TimePeriod.OneWeek)

    fireEvent.click(tabs[1])
    expect(handleSelect).toHaveBeenCalledWith(TimePeriod.TwoWeeks)

    fireEvent.click(tabs[2])
    expect(handleSelect).toHaveBeenCalledWith(TimePeriod.OneMonth)

    fireEvent.click(tabs[3])
    expect(handleSelect).toHaveBeenCalledWith(TimePeriod.ThreeMonths)
  })

  it("triggers selection on Enter key press", () => {
    const handleSelect = vi.fn()
    render(
      <PeriodSelector
        selectedPeriod={TimePeriod.OneMonth}
        onPeriodSelected={handleSelect}
      />
    )
    const tabs = screen.getAllByRole("tab")
    fireEvent.keyDown(tabs[0], { key: "Enter" })
    expect(handleSelect).toHaveBeenCalledWith(TimePeriod.OneWeek)
  })

  it("triggers selection on Space key press", () => {
    const handleSelect = vi.fn()
    render(
      <PeriodSelector
        selectedPeriod={TimePeriod.OneMonth}
        onPeriodSelected={handleSelect}
      />
    )
    const tabs = screen.getAllByRole("tab")
    fireEvent.keyDown(tabs[1], { key: " " })
    expect(handleSelect).toHaveBeenCalledWith(TimePeriod.TwoWeeks)
  })

  it("does not trigger selection on unrelated key press", () => {
    const handleSelect = vi.fn()
    render(
      <PeriodSelector
        selectedPeriod={TimePeriod.OneMonth}
        onPeriodSelected={handleSelect}
      />
    )
    const tabs = screen.getAllByRole("tab")
    fireEvent.keyDown(tabs[0], { key: "ArrowRight" })
    // Only click-based calls from the existing handler, not keyboard
    expect(handleSelect).not.toHaveBeenCalled()
  })

  it("applies custom className to the container", () => {
    const { container } = render(
      <PeriodSelector {...defaultProps} className="my-custom" />
    )
    const tablist = container.querySelector("[role='tablist']") as HTMLElement
    expect(tablist.classList.contains("my-custom")).toBe(true)
  })

  it("selected tab has tabIndex=0, others have tabIndex=-1", () => {
    render(<PeriodSelector {...defaultProps} />)
    const tabs = screen.getAllByRole("tab")
    // OneMonth (index 2) is selected
    expect(tabs[0].getAttribute("tabindex")).toBe("-1")
    expect(tabs[1].getAttribute("tabindex")).toBe("-1")
    expect(tabs[2].getAttribute("tabindex")).toBe("0")
    expect(tabs[3].getAttribute("tabindex")).toBe("-1")
  })
})
