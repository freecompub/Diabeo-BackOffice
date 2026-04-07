/**
 * @vitest-environment jsdom
 */

/**
 * Tests for Phase 11 Organism components: DiabeoCard, DiabeoEmptyState, MetricCard.
 *
 * Clinical safety context: organisms compose atoms and molecules into
 * clinical views. MetricCard displays KPI values that guide treatment
 * decisions; DiabeoEmptyState communicates data availability.
 */

import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

import { DiabeoCard } from "@/components/diabeo/DiabeoCard"
import { DiabeoEmptyState } from "@/components/diabeo/DiabeoEmptyState"
import { MetricCard } from "@/components/diabeo/MetricCard"

// ─── DiabeoCard ──────────────────────────────────────────────────────────────

describe("DiabeoCard", () => {
  it("renders children content", () => {
    render(
      <DiabeoCard>
        <p>Card content</p>
      </DiabeoCard>
    )
    expect(screen.getByText("Card content")).toBeTruthy()
  })

  it("applies elevated variant classes by default", () => {
    const { container } = render(
      <DiabeoCard>Default</DiabeoCard>
    )
    // elevated variant includes shadow-diabeo-sm
    const card = container.firstElementChild as HTMLElement
    expect(card.classList.contains("shadow-diabeo-sm")).toBe(true)
  })

  it("applies filled variant classes", () => {
    const { container } = render(
      <DiabeoCard variant="filled">Filled</DiabeoCard>
    )
    const card = container.firstElementChild as HTMLElement
    expect(card.classList.contains("bg-neutral-50")).toBe(true)
    expect(card.classList.contains("shadow-none")).toBe(true)
  })

  it("applies outlined variant classes", () => {
    const { container } = render(
      <DiabeoCard variant="outlined">Outlined</DiabeoCard>
    )
    const card = container.firstElementChild as HTMLElement
    expect(card.classList.contains("border")).toBe(true)
    expect(card.classList.contains("border-gray-200")).toBe(true)
  })

  it("applies padding classes", () => {
    const { container } = render(
      <DiabeoCard padding="lg">Large padding</DiabeoCard>
    )
    const card = container.firstElementChild as HTMLElement
    expect(card.classList.contains("p-6")).toBe(true)
  })

  it("applies no padding when padding=none", () => {
    const { container } = render(
      <DiabeoCard padding="none">No padding</DiabeoCard>
    )
    const card = container.firstElementChild as HTMLElement
    expect(card.classList.contains("p-0")).toBe(true)
  })

  it("applies clickable styles when clickable is true", () => {
    const { container } = render(
      <DiabeoCard clickable>Clickable</DiabeoCard>
    )
    const card = container.firstElementChild as HTMLElement
    expect(card.classList.contains("cursor-pointer")).toBe(true)
  })

  it("does not apply cursor-pointer when not clickable", () => {
    const { container } = render(
      <DiabeoCard>Not clickable</DiabeoCard>
    )
    const card = container.firstElementChild as HTMLElement
    expect(card.classList.contains("cursor-pointer")).toBe(false)
  })

  it("applies additional className", () => {
    const { container } = render(
      <DiabeoCard className="custom-class">Custom</DiabeoCard>
    )
    const card = container.firstElementChild as HTMLElement
    expect(card.classList.contains("custom-class")).toBe(true)
  })
})

// ─── DiabeoEmptyState ────────────────────────────────────────────────────────

describe("DiabeoEmptyState", () => {
  it("renders with role=status", () => {
    render(<DiabeoEmptyState variant="noData" />)
    expect(screen.getByRole("status")).toBeTruthy()
  })

  it("renders default title for noData variant (from i18n mock)", () => {
    render(<DiabeoEmptyState variant="noData" />)
    // The mock returns the translation key: emptyState.noData.title
    expect(screen.getByText("emptyState.noData.title")).toBeTruthy()
  })

  it("renders default message for noData variant", () => {
    render(<DiabeoEmptyState variant="noData" />)
    expect(screen.getByText("emptyState.noData.message")).toBeTruthy()
  })

  it("renders default title for noSearchResults variant", () => {
    render(<DiabeoEmptyState variant="noSearchResults" />)
    expect(screen.getByText("emptyState.noSearchResults.title")).toBeTruthy()
  })

  it("renders default title for error variant", () => {
    render(<DiabeoEmptyState variant="error" />)
    expect(screen.getByText("emptyState.error.title")).toBeTruthy()
  })

  it("renders default title for insufficientData variant", () => {
    render(<DiabeoEmptyState variant="insufficientData" />)
    expect(screen.getByText("emptyState.insufficientData.title")).toBeTruthy()
  })

  it("renders threshold in message for insufficientData variant", () => {
    render(<DiabeoEmptyState variant="insufficientData" threshold={45} />)
    // The mock replaces {threshold} with the value
    expect(
      screen.getByText("emptyState.insufficientData.messageWithThreshold")
    ).toBeTruthy()
  })

  it("overrides title when provided via prop", () => {
    render(
      <DiabeoEmptyState variant="noData" title="Aucun patient" />
    )
    expect(screen.getByText("Aucun patient")).toBeTruthy()
    expect(screen.queryByText("emptyState.noData.title")).toBeNull()
  })

  it("overrides message when provided via prop", () => {
    render(
      <DiabeoEmptyState
        variant="noData"
        message="Ajoutez votre premier patient"
      />
    )
    expect(screen.getByText("Ajoutez votre premier patient")).toBeTruthy()
  })

  it("renders action button when action is provided", () => {
    const handleAction = vi.fn()
    render(
      <DiabeoEmptyState
        variant="noData"
        action={{ label: "Ajouter", onClick: handleAction }}
      />
    )
    const button = screen.getByRole("button")
    expect(button.textContent).toBe("Ajouter")
  })

  it("calls action.onClick when action button is clicked", () => {
    const handleAction = vi.fn()
    render(
      <DiabeoEmptyState
        variant="noData"
        action={{ label: "Ajouter", onClick: handleAction }}
      />
    )
    fireEvent.click(screen.getByRole("button"))
    expect(handleAction).toHaveBeenCalledOnce()
  })

  it("does not render action button when action is not provided", () => {
    render(<DiabeoEmptyState variant="noData" />)
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("has aria-label matching the title", () => {
    render(
      <DiabeoEmptyState variant="noData" title="Aucun patient" />
    )
    expect(screen.getByLabelText("Aucun patient")).toBeTruthy()
  })
})

// ─── MetricCard ──────────────────────────────────────────────────────────────

describe("MetricCard", () => {
  it("renders the title", () => {
    render(<MetricCard title="Temps en cible" value={72} unit="%" />)
    expect(screen.getByText("Temps en cible")).toBeTruthy()
  })

  it("renders the value", () => {
    render(<MetricCard title="TIR" value={72} unit="%" />)
    expect(screen.getByText("72")).toBeTruthy()
  })

  it("renders the unit", () => {
    render(<MetricCard title="TIR" value={72} unit="%" />)
    expect(screen.getByText("%")).toBeTruthy()
  })

  it("has aria-label combining title, value, and unit", () => {
    render(<MetricCard title="TIR" value={72} unit="%" />)
    expect(screen.getByLabelText("TIR: 72 %")).toBeTruthy()
  })

  it("shows loading skeleton when loading is true", () => {
    render(<MetricCard title="TIR" value={72} loading />)
    // The skeleton container has aria-busy
    expect(screen.getByLabelText("Chargement...")).toBeTruthy()
  })

  it("does not show value when loading", () => {
    render(<MetricCard title="TIR" value={72} loading />)
    expect(screen.queryByText("72")).toBeNull()
  })

  it("shows trend information when trend is provided", () => {
    render(
      <MetricCard
        title="TIR"
        value={72}
        unit="%"
        trend={{ direction: "up", value: "+3%" }}
      />
    )
    expect(screen.getByText("+3%")).toBeTruthy()
  })

  it("trend has accessible label for up direction", () => {
    render(
      <MetricCard
        title="TIR"
        value={72}
        trend={{ direction: "up", value: "+3%" }}
      />
    )
    expect(screen.getByLabelText(/En hausse de \+3%/)).toBeTruthy()
  })

  it("trend has accessible label for down direction", () => {
    render(
      <MetricCard
        title="TIR"
        value={72}
        trend={{ direction: "down", value: "-2%" }}
      />
    )
    expect(screen.getByLabelText(/En baisse de -2%/)).toBeTruthy()
  })

  it("has role=button when onClick is provided", () => {
    const handleClick = vi.fn()
    render(
      <MetricCard title="TIR" value={72} onClick={handleClick} />
    )
    expect(screen.getByRole("button")).toBeTruthy()
  })

  it("has role=region when onClick is not provided", () => {
    render(<MetricCard title="TIR" value={72} />)
    expect(screen.getByRole("region")).toBeTruthy()
  })

  it("calls onClick when clicked", () => {
    const handleClick = vi.fn()
    render(
      <MetricCard title="TIR" value={72} onClick={handleClick} />
    )
    fireEvent.click(screen.getByRole("button"))
    expect(handleClick).toHaveBeenCalledOnce()
  })

  it("calls onClick on Enter key press when clickable", () => {
    const handleClick = vi.fn()
    render(
      <MetricCard title="TIR" value={72} onClick={handleClick} />
    )
    fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" })
    expect(handleClick).toHaveBeenCalledOnce()
  })

  it("renders icon when provided", () => {
    const icon = <span data-testid="metric-icon">IC</span>
    render(<MetricCard title="TIR" value={72} icon={icon} />)
    expect(screen.getByTestId("metric-icon")).toBeTruthy()
  })
})
