/**
 * @vitest-environment jsdom
 */

/**
 * Tests for QuickActionsPanel (US-3363).
 *
 * Clinical safety: this panel exposes the entry points for patient-initiated
 * actions (log glucose, add meal, calculate bolus, export report). A regression
 * here could prevent a patient from recording a hypo event.
 */

import { describe, it, expect, vi } from "vitest"

vi.mock("next-intl", async () =>
  (await import("../helpers/nextIntlMock")).makeNextIntlMock())
import { render, screen, fireEvent } from "@testing-library/react"
import { QuickActionsPanel } from "@/components/diabeo/QuickActionsPanel"

describe("QuickActionsPanel", () => {
  it("renders the 4 expected actions", () => {
    render(<QuickActionsPanel onAction={() => {}} />)
    expect(screen.getByRole("button", { name: "Saisir une glycémie" })).toBeTruthy()
    expect(screen.getByRole("button", { name: /Ajouter un repas/i })).toBeTruthy()
    expect(screen.getByRole("button", { name: /Calculer un bolus/i })).toBeTruthy()
    expect(screen.getByRole("button", { name: /Exporter un rapport/i })).toBeTruthy()
  })

  it("invokes onAction with the matching id on click", () => {
    const onAction = vi.fn()
    render(<QuickActionsPanel onAction={onAction} />)
    fireEvent.click(screen.getByRole("button", { name: "Saisir une glycémie" }))
    expect(onAction).toHaveBeenCalledWith("logGlucose")
    fireEvent.click(screen.getByRole("button", { name: /Calculer un bolus/i }))
    expect(onAction).toHaveBeenCalledWith("calculateBolus")
  })

  it("every action button is keyboard-focusable", () => {
    const { container } = render(<QuickActionsPanel onAction={() => {}} />)
    const buttons = container.querySelectorAll("button")
    expect(buttons.length).toBe(4)
    for (const b of buttons) {
      // No explicit tabindex = -1 → focusable by default
      expect(b.getAttribute("tabindex")).not.toBe("-1")
    }
  })

  it("renders the section heading", () => {
    render(<QuickActionsPanel onAction={() => {}} />)
    expect(screen.getByText("Actions rapides")).toBeTruthy()
  })
})
