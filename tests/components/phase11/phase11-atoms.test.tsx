/**
 * @vitest-environment jsdom
 */

/**
 * Tests for Phase 11 Atom components: DiabeoText, DiabeoIcon, GlucoseBadge,
 * TrendIndicator, MetricLabel.
 *
 * Clinical safety context: these atoms form the building blocks for all
 * clinical data displays. Incorrect rendering (e.g., wrong zone color on
 * GlucoseBadge, missing trend arrow) could mislead clinicians.
 */

import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"

import { DiabeoText } from "@/components/diabeo/DiabeoText"
import { DiabeoIcon } from "@/components/diabeo/DiabeoIcon"
import { GlucoseBadge } from "@/components/diabeo/GlucoseBadge"
import { TrendIndicator } from "@/components/diabeo/TrendIndicator"
import { MetricLabel } from "@/components/diabeo/MetricLabel"

// ─── DiabeoText ──────────────────────────────────────────────────────────────

describe("DiabeoText", () => {
  it("renders an h1 tag for displayLarge variant", () => {
    const { container } = render(
      <DiabeoText variant="displayLarge">Page title</DiabeoText>
    )
    const h1 = container.querySelector("h1")
    expect(h1).toBeTruthy()
    expect(h1?.textContent).toBe("Page title")
  })

  it("renders an h2 tag for displaySmall variant", () => {
    const { container } = render(
      <DiabeoText variant="displaySmall">Section title</DiabeoText>
    )
    expect(container.querySelector("h2")).toBeTruthy()
  })

  it("renders an h2 tag for headingLarge variant", () => {
    const { container } = render(
      <DiabeoText variant="headingLarge">Heading</DiabeoText>
    )
    expect(container.querySelector("h2")).toBeTruthy()
  })

  it("renders an h3 tag for headingMedium variant", () => {
    const { container } = render(
      <DiabeoText variant="headingMedium">Sub heading</DiabeoText>
    )
    expect(container.querySelector("h3")).toBeTruthy()
  })

  it("renders an h4 tag for headingSmall variant", () => {
    const { container } = render(
      <DiabeoText variant="headingSmall">Minor heading</DiabeoText>
    )
    expect(container.querySelector("h4")).toBeTruthy()
  })

  it("renders a p tag for bodyMedium variant (default)", () => {
    const { container } = render(<DiabeoText>Body text</DiabeoText>)
    expect(container.querySelector("p")).toBeTruthy()
  })

  it("renders a p tag for bodyLarge variant", () => {
    const { container } = render(
      <DiabeoText variant="bodyLarge">Large body</DiabeoText>
    )
    expect(container.querySelector("p")).toBeTruthy()
  })

  it("renders a p tag for bodySmall variant", () => {
    const { container } = render(
      <DiabeoText variant="bodySmall">Small body</DiabeoText>
    )
    expect(container.querySelector("p")).toBeTruthy()
  })

  it("renders a span tag for labelLarge variant", () => {
    const { container } = render(
      <DiabeoText variant="labelLarge">Label</DiabeoText>
    )
    expect(container.querySelector("span")).toBeTruthy()
  })

  it("renders a span tag for captionSmall variant", () => {
    const { container } = render(
      <DiabeoText variant="captionSmall">Caption</DiabeoText>
    )
    expect(container.querySelector("span")).toBeTruthy()
  })

  it("applies additional className", () => {
    const { container } = render(
      <DiabeoText className="my-custom-class">Styled</DiabeoText>
    )
    expect(container.firstElementChild?.classList.contains("my-custom-class")).toBe(true)
  })

  it("overrides the tag via 'as' prop", () => {
    const { container } = render(
      <DiabeoText variant="captionSmall" as="time">
        Il y a 3 min
      </DiabeoText>
    )
    expect(container.querySelector("time")).toBeTruthy()
  })

  it("applies color variant class", () => {
    const { container } = render(
      <DiabeoText color="primary">Teal text</DiabeoText>
    )
    expect(container.firstElementChild?.classList.contains("text-teal-600")).toBe(true)
  })
})

// ─── DiabeoIcon ──────────────────────────────────────────────────────────────

describe("DiabeoIcon", () => {
  it("renders an SVG element", () => {
    const { container } = render(
      <DiabeoIcon name="heart" aria-hidden={true} />
    )
    expect(container.querySelector("svg")).toBeTruthy()
  })

  it("renders with correct default size (md = 20px)", () => {
    const { container } = render(
      <DiabeoIcon name="heart" aria-hidden={true} />
    )
    const svg = container.querySelector("svg")
    expect(svg?.getAttribute("width")).toBe("20")
    expect(svg?.getAttribute("height")).toBe("20")
  })

  it("renders with sm size (16px)", () => {
    const { container } = render(
      <DiabeoIcon name="heart" size="sm" aria-hidden={true} />
    )
    const svg = container.querySelector("svg")
    expect(svg?.getAttribute("width")).toBe("16")
  })

  it("renders with lg size (24px)", () => {
    const { container } = render(
      <DiabeoIcon name="heart" size="lg" aria-hidden={true} />
    )
    const svg = container.querySelector("svg")
    expect(svg?.getAttribute("width")).toBe("24")
  })

  it("renders with xl size (32px)", () => {
    const { container } = render(
      <DiabeoIcon name="heart" size="xl" aria-hidden={true} />
    )
    const svg = container.querySelector("svg")
    expect(svg?.getAttribute("width")).toBe("32")
  })

  it("has aria-hidden=true when no label is provided", () => {
    const { container } = render(
      <DiabeoIcon name="heart" aria-hidden={true} />
    )
    const svg = container.querySelector("svg")
    expect(svg?.getAttribute("aria-hidden")).toBe("true")
  })

  it("has role=none when no label is provided", () => {
    const { container } = render(
      <DiabeoIcon name="heart" aria-hidden={true} />
    )
    const svg = container.querySelector("svg")
    expect(svg?.getAttribute("role")).toBe("none")
  })

  it("has aria-label and role=img when label is provided", () => {
    const { container } = render(
      <DiabeoIcon name="warning" aria-label="Alerte glycemie" />
    )
    const svg = container.querySelector("svg")
    expect(svg?.getAttribute("aria-label")).toBe("Alerte glycemie")
    expect(svg?.getAttribute("role")).toBe("img")
    // Should NOT have aria-hidden when label is set
    expect(svg?.getAttribute("aria-hidden")).toBeNull()
  })

  it("renders different icon names without error", () => {
    const names = ["profile", "settings", "insulin", "calendar"] as const
    names.forEach((name) => {
      const { container } = render(
        <DiabeoIcon name={name} aria-hidden={true} />
      )
      expect(container.querySelector("svg")).toBeTruthy()
    })
  })
})

// ─── GlucoseBadge ────────────────────────────────────────────────────────────

describe("GlucoseBadge", () => {
  it("renders value with default unit (mg/dL)", () => {
    render(<GlucoseBadge value={120} />)
    const badge = screen.getByLabelText(/120 mg\/dL/)
    expect(badge).toBeTruthy()
  })

  it("renders value in g/L when unit is g/L", () => {
    render(<GlucoseBadge value={120} unit="g/L" />)
    // 120 mg/dL = 1.20 g/L
    const badge = screen.getByLabelText(/1\.20 g\/L/)
    expect(badge).toBeTruthy()
  })

  it("renders value in mmol/L when unit is mmol/L", () => {
    render(<GlucoseBadge value={120} unit="mmol/L" />)
    // 120 / 18.0182 = ~6.7
    const badge = screen.getByLabelText(/6\.7 mmol\/L/)
    expect(badge).toBeTruthy()
  })

  it("displays the unit text inside the badge", () => {
    const { container } = render(<GlucoseBadge value={120} unit="mg/dL" />)
    expect(container.textContent).toContain("mg/dL")
  })

  it("applies normal zone for in-range value (120 mg/dL)", () => {
    render(<GlucoseBadge value={120} />)
    // i18n mock returns key path: glycemia.zone.normal
    const badge = screen.getByLabelText(/glycemia\.zone\.normal/)
    expect(badge).toBeTruthy()
  })

  it("applies very-low zone for value below 54 mg/dL", () => {
    render(<GlucoseBadge value={40} />)
    const badge = screen.getByLabelText(/glycemia\.zone\.veryLow/)
    expect(badge).toBeTruthy()
  })

  it("applies high zone for value above 180 mg/dL", () => {
    render(<GlucoseBadge value={200} />)
    const badge = screen.getByLabelText(/glycemia\.zone\.high/)
    expect(badge).toBeTruthy()
  })

  it("applies critical zone for value above 400 mg/dL", () => {
    render(<GlucoseBadge value={450} />)
    const badge = screen.getByLabelText(/glycemia\.zone\.critical/)
    expect(badge).toBeTruthy()
  })

  it("has role=alert for very-low values", () => {
    render(<GlucoseBadge value={40} />)
    const alert = screen.getByRole("alert")
    expect(alert).toBeTruthy()
  })

  it("has role=alert for critical values", () => {
    render(<GlucoseBadge value={450} />)
    const alert = screen.getByRole("alert")
    expect(alert).toBeTruthy()
  })

  it("does not have role=alert for normal values", () => {
    const { container } = render(<GlucoseBadge value={120} />)
    expect(container.querySelector("[role='alert']")).toBeNull()
  })
})

// ─── TrendIndicator ──────────────────────────────────────────────────────────

describe("TrendIndicator", () => {
  it("renders with aria-label for stable trend", () => {
    render(<TrendIndicator trend="stable" />)
    // i18n mock returns key path: glycemia.trend.stable
    expect(screen.getByLabelText("glycemia.trend.stable")).toBeTruthy()
  })

  it("renders with aria-label for rising trend", () => {
    render(<TrendIndicator trend="rising" />)
    expect(screen.getByLabelText("glycemia.trend.rising")).toBeTruthy()
  })

  it("renders with aria-label for rising_fast trend", () => {
    render(<TrendIndicator trend="rising_fast" />)
    expect(screen.getByLabelText("glycemia.trend.risingFast")).toBeTruthy()
  })

  it("renders with aria-label for falling trend", () => {
    render(<TrendIndicator trend="falling" />)
    expect(screen.getByLabelText("glycemia.trend.falling")).toBeTruthy()
  })

  it("renders with aria-label for falling_fast trend", () => {
    render(<TrendIndicator trend="falling_fast" />)
    expect(screen.getByLabelText("glycemia.trend.fallingFast")).toBeTruthy()
  })

  it("renders with aria-label for unknown trend", () => {
    render(<TrendIndicator trend="unknown" />)
    expect(screen.getByLabelText("glycemia.trend.unknown")).toBeTruthy()
  })

  it("has role=alert for rising_fast (critical)", () => {
    render(<TrendIndicator trend="rising_fast" />)
    expect(screen.getByRole("alert")).toBeTruthy()
  })

  it("has role=alert for falling_fast (critical)", () => {
    render(<TrendIndicator trend="falling_fast" />)
    expect(screen.getByRole("alert")).toBeTruthy()
  })

  it("has role=img for non-critical trends", () => {
    render(<TrendIndicator trend="stable" />)
    expect(screen.getByRole("img")).toBeTruthy()
  })

  it("renders an SVG icon inside", () => {
    const { container } = render(<TrendIndicator trend="stable" />)
    expect(container.querySelector("svg")).toBeTruthy()
  })

  it("SVG icon is aria-hidden", () => {
    const { container } = render(<TrendIndicator trend="stable" />)
    const svg = container.querySelector("svg")
    expect(svg?.getAttribute("aria-hidden")).toBe("true")
  })
})

// ─── MetricLabel ─────────────────────────────────────────────────────────────

describe("MetricLabel", () => {
  it("renders the label text", () => {
    render(<MetricLabel label="Glycemie moyenne" value={142} unit="mg/dL" />)
    expect(screen.getByText("Glycemie moyenne")).toBeTruthy()
  })

  it("renders the value", () => {
    render(<MetricLabel label="TIR" value="78%" />)
    expect(screen.getByText("78%")).toBeTruthy()
  })

  it("renders the unit when provided", () => {
    render(<MetricLabel label="Glycemie" value={142} unit="mg/dL" />)
    expect(screen.getByText("mg/dL")).toBeTruthy()
  })

  it("does not render unit when not provided", () => {
    const { container } = render(<MetricLabel label="Score" value={85} />)
    // The dd element should not contain a unit span
    const dd = container.querySelector("dd")
    expect(dd?.textContent).toBe("85")
  })

  it("renders as a dl element (description list)", () => {
    const { container } = render(
      <MetricLabel label="Test" value={1} />
    )
    expect(container.querySelector("dl")).toBeTruthy()
  })

  it("has combined aria-label with label, value, and unit", () => {
    render(<MetricLabel label="Glycemie" value={142} unit="mg/dL" />)
    const dl = screen.getByLabelText("Glycemie 142 mg/dL")
    expect(dl).toBeTruthy()
  })

  it("has aria-label without unit when unit is absent", () => {
    render(<MetricLabel label="Score" value={85} />)
    const dl = screen.getByLabelText("Score 85")
    expect(dl).toBeTruthy()
  })

  it("renders label in dt and value in dd", () => {
    const { container } = render(
      <MetricLabel label="Bolus" value={3.5} unit="U" />
    )
    const dt = container.querySelector("dt")
    const dd = container.querySelector("dd")
    expect(dt?.textContent).toBe("Bolus")
    expect(dd?.textContent).toContain("3.5")
  })
})
