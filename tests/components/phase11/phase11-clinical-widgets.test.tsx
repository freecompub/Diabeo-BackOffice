/**
 * @vitest-environment jsdom
 */

/**
 * Tests for clinical widgets: GlycemicVariabilityWidget and HypoglycemiaCounter.
 *
 * Clinical safety context:
 *
 * GlycemicVariabilityWidget — Coefficient of Variation (CV):
 *   CV is the ratio of standard deviation to mean glucose, expressed as %.
 *   Stability thresholds (Danne et al., Diabetes Care 2017):
 *     Stable   : CV < 36 %  — low variability, good glycemic control
 *     Moderate : CV 36–50 % — requires monitoring
 *     Unstable : CV > 50 %  — high hypoglycemia risk, therapy review needed
 *   RISK: Incorrect classification could mask dangerously high variability.
 *
 * HypoglycemiaCounter:
 *   Displays total hypo events and time since last event.
 *   RISK: Missing or incorrect count could delay treatment adjustments.
 */

import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

// Mock recharts — components use ResponsiveContainer/BarChart which need
// browser layout APIs unavailable in jsdom.
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  BarChart: ({ children }: { children: React.ReactNode }) => (
    <svg data-testid="bar-chart">{children}</svg>
  ),
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
}))

import { GlycemicVariabilityWidget } from "@/components/diabeo/widgets/GlycemicVariabilityWidget"
import { HypoglycemiaCounter } from "@/components/diabeo/charts/HypoglycemiaCounter"

// ─── GlycemicVariabilityWidget ──────────────────────────────────────────────

describe("GlycemicVariabilityWidget", () => {
  describe("stability classification", () => {
    it("classifies CV < 36 as stable (green)", () => {
      const { container } = render(
        <GlycemicVariabilityWidget value={35.9} />
      )
      expect(container.querySelector(".text-glycemia-normal")).toBeTruthy()
    })

    it("classifies CV = 36 as moderate (amber) — boundary", () => {
      const { container } = render(
        <GlycemicVariabilityWidget value={36} />
      )
      expect(container.querySelector(".text-glycemia-high")).toBeTruthy()
    })

    it("classifies CV = 50 as moderate (amber)", () => {
      const { container } = render(
        <GlycemicVariabilityWidget value={50} />
      )
      expect(container.querySelector(".text-glycemia-high")).toBeTruthy()
    })

    it("classifies CV = 50.1 as unstable (red) — boundary", () => {
      const { container } = render(
        <GlycemicVariabilityWidget value={50.1} />
      )
      expect(container.querySelector(".text-glycemia-low")).toBeTruthy()
    })

    it("classifies CV = 0 as stable", () => {
      const { container } = render(
        <GlycemicVariabilityWidget value={0} />
      )
      expect(container.querySelector(".text-glycemia-normal")).toBeTruthy()
    })

    it("classifies CV = 100 as unstable", () => {
      const { container } = render(
        <GlycemicVariabilityWidget value={100} />
      )
      expect(container.querySelector(".text-glycemia-low")).toBeTruthy()
    })
  })

  describe("value display", () => {
    it("renders the value with one decimal place", () => {
      render(<GlycemicVariabilityWidget value={32.456} />)
      expect(screen.getByText("32.5")).toBeTruthy()
    })

    it("renders the percent sign", () => {
      render(<GlycemicVariabilityWidget value={32} />)
      expect(screen.getByText("%")).toBeTruthy()
    })

    it("renders the translated CV label", () => {
      render(<GlycemicVariabilityWidget value={32} />)
      expect(screen.getByText("metrics.cv")).toBeTruthy()
    })

    it("renders the translated stability label", () => {
      render(<GlycemicVariabilityWidget value={32} />)
      // mock returns "metrics.stability.stable"
      expect(screen.getByText("metrics.stability.stable")).toBeTruthy()
    })
  })

  describe("accessibility", () => {
    it("has aria-label with metric name, value, and stability", () => {
      render(<GlycemicVariabilityWidget value={32} />)
      expect(
        screen.getByLabelText("metrics.cv: 32.0% — metrics.stability.stable")
      ).toBeTruthy()
    })
  })

  describe("loading state", () => {
    it("shows skeleton when loading is true", () => {
      render(<GlycemicVariabilityWidget value={32} loading />)
      expect(screen.getByLabelText("Chargement du widget")).toBeTruthy()
    })

    it("does not show value when loading", () => {
      render(<GlycemicVariabilityWidget value={32} loading />)
      expect(screen.queryByText("32.0")).toBeNull()
    })
  })

  describe("interactivity", () => {
    it("has role='button' when onClick is provided", () => {
      const handleClick = vi.fn()
      render(
        <GlycemicVariabilityWidget value={32} onClick={handleClick} />
      )
      expect(screen.getByRole("button")).toBeTruthy()
    })

    it("calls onClick when clicked", () => {
      const handleClick = vi.fn()
      render(
        <GlycemicVariabilityWidget value={32} onClick={handleClick} />
      )
      fireEvent.click(screen.getByRole("button"))
      expect(handleClick).toHaveBeenCalledOnce()
    })

    it("calls onClick on Enter key press", () => {
      const handleClick = vi.fn()
      render(
        <GlycemicVariabilityWidget value={32} onClick={handleClick} />
      )
      fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" })
      expect(handleClick).toHaveBeenCalledOnce()
    })

    it("calls onClick on Space key press", () => {
      const handleClick = vi.fn()
      render(
        <GlycemicVariabilityWidget value={32} onClick={handleClick} />
      )
      fireEvent.keyDown(screen.getByRole("button"), { key: " " })
      expect(handleClick).toHaveBeenCalledOnce()
    })

    it("has no role='button' when onClick is not provided", () => {
      render(<GlycemicVariabilityWidget value={32} />)
      expect(screen.queryByRole("button")).toBeNull()
    })
  })
})

// ─── HypoglycemiaCounter ────────────────────────────────────────────────────

describe("HypoglycemiaCounter", () => {
  describe("total count display", () => {
    it("renders the total count", () => {
      render(
        <HypoglycemiaCounter data={{ totalCount: 5, dailyCounts: [] }} />
      )
      expect(screen.getByText("5")).toBeTruthy()
    })

    it("renders zero count", () => {
      render(
        <HypoglycemiaCounter data={{ totalCount: 0, dailyCounts: [] }} />
      )
      expect(screen.getByText("0")).toBeTruthy()
    })

    it("renders the hypoCount label", () => {
      render(
        <HypoglycemiaCounter data={{ totalCount: 3, dailyCounts: [] }} />
      )
      expect(screen.getByText("chart.hypoCount")).toBeTruthy()
    })
  })

  describe("last event display", () => {
    it("shows 'noHypo' text when no lastEventTime and count is 0", () => {
      render(
        <HypoglycemiaCounter data={{ totalCount: 0, dailyCounts: [] }} />
      )
      expect(screen.getByText("chart.noHypo")).toBeTruthy()
    })

    it("shows 'noHypo' text when lastEventTime is undefined", () => {
      render(
        <HypoglycemiaCounter data={{ totalCount: 3, dailyCounts: [] }} />
      )
      expect(screen.getByText("chart.noHypo")).toBeTruthy()
    })

    it("shows last event relative time when lastEventTime is provided", () => {
      const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000)
      render(
        <HypoglycemiaCounter
          data={{ totalCount: 2, lastEventTime: thirtyMinAgo, dailyCounts: [] }}
        />
      )
      expect(screen.getByText(/chart\.lastHypo.*30min/)).toBeTruthy()
    })
  })

  describe("color coding", () => {
    it("applies warning color when totalCount > 0", () => {
      const { container } = render(
        <HypoglycemiaCounter data={{ totalCount: 3, dailyCounts: [] }} />
      )
      expect(container.querySelector(".text-glycemia-low")).toBeTruthy()
    })

    it("applies normal color when totalCount is 0", () => {
      const { container } = render(
        <HypoglycemiaCounter data={{ totalCount: 0, dailyCounts: [] }} />
      )
      expect(container.querySelector(".text-glycemia-normal")).toBeTruthy()
    })
  })

  describe("histogram", () => {
    it("renders the bar chart when dailyCounts has data", () => {
      render(
        <HypoglycemiaCounter
          data={{
            totalCount: 3,
            dailyCounts: [
              { date: "2026-04-01", count: 1 },
              { date: "2026-04-02", count: 2 },
            ],
          }}
        />
      )
      expect(screen.getByTestId("bar-chart")).toBeTruthy()
    })

    it("does not render chart when dailyCounts is empty", () => {
      render(
        <HypoglycemiaCounter data={{ totalCount: 0, dailyCounts: [] }} />
      )
      expect(screen.queryByTestId("bar-chart")).toBeNull()
    })
  })
})

// ─── formatRelativeTime (tested indirectly via HypoglycemiaCounter) ─────────

describe("formatRelativeTime (via HypoglycemiaCounter rendering)", () => {
  it("formats 0 minutes ago as '0min'", () => {
    const now = new Date()
    render(
      <HypoglycemiaCounter
        data={{ totalCount: 1, lastEventTime: now, dailyCounts: [] }}
      />
    )
    expect(screen.getByText(/0min/)).toBeTruthy()
  })

  it("formats 30 minutes ago as '30min'", () => {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000)
    render(
      <HypoglycemiaCounter
        data={{ totalCount: 1, lastEventTime: thirtyMinAgo, dailyCounts: [] }}
      />
    )
    expect(screen.getByText(/30min/)).toBeTruthy()
  })

  it("formats 2 hours ago as '2h'", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
    render(
      <HypoglycemiaCounter
        data={{ totalCount: 1, lastEventTime: twoHoursAgo, dailyCounts: [] }}
      />
    )
    expect(screen.getByText(/2h/)).toBeTruthy()
  })

  it("formats 3 days ago as '3j'", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
    render(
      <HypoglycemiaCounter
        data={{ totalCount: 1, lastEventTime: threeDaysAgo, dailyCounts: [] }}
      />
    )
    expect(screen.getByText(/3j/)).toBeTruthy()
  })
})
