/**
 * @vitest-environment jsdom
 *
 * Tests unitaires pour `<StatusFilter>` (US-2500-UI iter 8).
 *
 * Couvre :
 *   - Render 6 chips (1 par statut)
 *   - Toggle chip : add/remove du Set value
 *   - aria-pressed (a11y SR)
 *   - Defaults metier exposés via export
 */

import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import type { AppointmentStatus } from "@prisma/client"

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) => k,
}))

const { StatusFilter, DEFAULT_STATUS_FILTER } = await import(
  "@/components/diabeo/appointments/StatusFilter"
)

describe("<StatusFilter>", () => {
  it("DEFAULT_STATUS_FILTER exporte les 3 statuts metier 'à venir'", () => {
    expect(DEFAULT_STATUS_FILTER.has("scheduled" as AppointmentStatus)).toBe(true)
    expect(DEFAULT_STATUS_FILTER.has("pending_validation" as AppointmentStatus)).toBe(true)
    expect(DEFAULT_STATUS_FILTER.has("confirmed" as AppointmentStatus)).toBe(true)
    // Et NE PAS exposer les statuts terminaux par défaut
    expect(DEFAULT_STATUS_FILTER.has("cancelled" as AppointmentStatus)).toBe(false)
    expect(DEFAULT_STATUS_FILTER.has("completed" as AppointmentStatus)).toBe(false)
    expect(DEFAULT_STATUS_FILTER.has("no_show" as AppointmentStatus)).toBe(false)
  })

  it("render 6 chips (1 par statut)", () => {
    const { container } = render(
      <StatusFilter value={DEFAULT_STATUS_FILTER} onChange={vi.fn()} />,
    )
    const buttons = container.querySelectorAll("button")
    expect(buttons.length).toBe(6)
  })

  it("aria-pressed='true' sur chips actifs, 'false' sur inactifs", () => {
    render(
      <StatusFilter
        value={new Set<AppointmentStatus>(["scheduled", "confirmed"])}
        onChange={vi.fn()}
      />,
    )
    const scheduledChip = screen.getByText("status.scheduled")
    const cancelledChip = screen.getByText("status.cancelled")
    expect(scheduledChip.getAttribute("aria-pressed")).toBe("true")
    expect(cancelledChip.getAttribute("aria-pressed")).toBe("false")
  })

  it("clic chip inactif → onChange(value + status)", () => {
    const onChange = vi.fn()
    render(
      <StatusFilter
        value={new Set<AppointmentStatus>(["scheduled"])}
        onChange={onChange}
      />,
    )
    fireEvent.click(screen.getByText("status.cancelled"))
    expect(onChange).toHaveBeenCalledTimes(1)
    const calledWith = onChange.mock.calls[0][0] as ReadonlySet<AppointmentStatus>
    expect(calledWith.has("scheduled")).toBe(true)
    expect(calledWith.has("cancelled")).toBe(true)
  })

  it("clic chip actif → onChange(value - status)", () => {
    const onChange = vi.fn()
    render(
      <StatusFilter
        value={new Set<AppointmentStatus>(["scheduled", "confirmed"])}
        onChange={onChange}
      />,
    )
    fireEvent.click(screen.getByText("status.confirmed"))
    expect(onChange).toHaveBeenCalledTimes(1)
    const calledWith = onChange.mock.calls[0][0] as ReadonlySet<AppointmentStatus>
    expect(calledWith.has("scheduled")).toBe(true)
    expect(calledWith.has("confirmed")).toBe(false)
  })

  it("role='group' + aria-label (WCAG 2.5.5 + 4.1.2)", () => {
    const { container } = render(
      <StatusFilter value={DEFAULT_STATUS_FILTER} onChange={vi.fn()} />,
    )
    const group = container.querySelector("[role='group']")
    expect(group).not.toBeNull()
    expect(group!.getAttribute("aria-label")).toBe("statusFilterLabel")
  })

  it("Fix FE-11 round 1 — touch targets min-h-[36px] WCAG 2.5.5 AA (24x24 min)", () => {
    const { container } = render(
      <StatusFilter value={DEFAULT_STATUS_FILTER} onChange={vi.fn()} />,
    )
    // FE-11 fix : min-h-[44px] + text-xs → mismatch visuel → reduced to 36px
    // (WCAG AA exige 24x24 minimum, 36 reste confortable sans visual bug).
    const buttons = container.querySelectorAll("button.min-h-\\[36px\\]")
    expect(buttons.length).toBe(6)
  })

  it("Fix FE-8 round 1 — focus-visible:ring-2 explicit (WCAG 2.4.7)", () => {
    const { container } = render(
      <StatusFilter value={DEFAULT_STATUS_FILTER} onChange={vi.fn()} />,
    )
    const buttons = container.querySelectorAll("button.focus-visible\\:ring-2")
    expect(buttons.length).toBe(6)
  })
})
