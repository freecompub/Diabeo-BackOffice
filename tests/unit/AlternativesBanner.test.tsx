/**
 * @vitest-environment jsdom
 *
 * Tests unitaires pour `<AlternativesBanner>` + `countPendingAlternatives`
 * (US-2500-UI iter 9).
 *
 * Couvre :
 *   - countPendingAlternatives : filtre status=cancelled + proposedAlt non null
 *     + TTL 7j non dépassé
 *   - Banner caché si count === 0
 *   - Banner affiché si count > 0 avec compteur correct
 *   - Click "Voir" → onShowAlternatives callback
 *   - role="region" + aria-label (a11y)
 */

import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import type { AppointmentStatus } from "@prisma/client"
import type { AppointmentListItem } from "@/components/diabeo/appointments/useAppointments"

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string, v?: Record<string, unknown>) => {
    if (v && "count" in v) return `${k}=${v.count}`
    return k
  },
}))

const { AlternativesBanner, countPendingAlternatives } = await import(
  "@/components/diabeo/appointments/AlternativesBanner"
)

function makeItem(overrides: Partial<AppointmentListItem> = {}): AppointmentListItem {
  return {
    id: 1,
    patientId: 7,
    memberId: 1,
    type: "diabeto",
    date: "2026-05-25",
    hour: "09:30:00",
    durationMinutes: 30,
    location: "in_person",
    status: "scheduled" as AppointmentStatus,
    proposedAlternativeAt: null,
    cancelledBy: null,
    cancelledAt: null,
    createdAt: "2026-05-01T00:00:00Z",
    updatedAt: "2026-05-01T00:00:00Z",
    ...overrides,
  }
}

describe("countPendingAlternatives", () => {
  it("compte 0 si aucun RDV cancelled avec proposedAlt", () => {
    expect(countPendingAlternatives([makeItem(), makeItem({ id: 2 })])).toBe(0)
  })

  it("compte les RDV cancelled + proposedAlt récent (< 7j)", () => {
    const recent = new Date(Date.now() - 24 * 3600 * 1000).toISOString() // -1j
    const items = [
      makeItem({ id: 1, status: "cancelled", proposedAlternativeAt: recent }),
      makeItem({ id: 2, status: "cancelled", proposedAlternativeAt: recent }),
      makeItem({ id: 3 }), // not cancelled
    ]
    expect(countPendingAlternatives(items)).toBe(2)
  })

  it("exclut RDV cancelled mais proposedAlt EXPIRÉ (> 7j)", () => {
    const expired = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString() // -8j
    const items = [
      makeItem({ id: 1, status: "cancelled", proposedAlternativeAt: expired }),
    ]
    expect(countPendingAlternatives(items)).toBe(0)
  })

  it("exclut RDV cancelled SANS proposedAlt", () => {
    const items = [
      makeItem({ id: 1, status: "cancelled", proposedAlternativeAt: null }),
    ]
    expect(countPendingAlternatives(items)).toBe(0)
  })
})

describe("<AlternativesBanner>", () => {
  const onShow = vi.fn()

  it("rien rendu si count === 0", () => {
    const { container } = render(
      <AlternativesBanner items={[]} onShowAlternatives={onShow} />,
    )
    expect(container.querySelector("[role='region']")).toBeNull()
  })

  it("affiche bandeau si count > 0 (recent cancelled + proposedAlt)", () => {
    const recent = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    render(
      <AlternativesBanner
        items={[
          makeItem({ id: 1, status: "cancelled", proposedAlternativeAt: recent }),
          makeItem({ id: 2, status: "cancelled", proposedAlternativeAt: recent }),
        ]}
        onShowAlternatives={onShow}
      />,
    )
    // Compteur visible (=2)
    expect(screen.getByText(/alternativesBannerMessage=2/)).toBeTruthy()
    // Bouton "Voir" visible
    expect(screen.getByText("alternativesBannerAction")).toBeTruthy()
  })

  it("role='region' + aria-label (a11y)", () => {
    const recent = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const { container } = render(
      <AlternativesBanner
        items={[makeItem({ id: 1, status: "cancelled", proposedAlternativeAt: recent })]}
        onShowAlternatives={onShow}
      />,
    )
    const region = container.querySelector("[role='region']")
    expect(region).not.toBeNull()
    expect(region!.getAttribute("aria-label")).toBe("alternativesBannerLabel")
  })

  it("click 'Voir' → onShowAlternatives appelé", () => {
    const onShowMock = vi.fn()
    const recent = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    render(
      <AlternativesBanner
        items={[makeItem({ id: 1, status: "cancelled", proposedAlternativeAt: recent })]}
        onShowAlternatives={onShowMock}
      />,
    )
    fireEvent.click(screen.getByText("alternativesBannerAction"))
    expect(onShowMock).toHaveBeenCalledTimes(1)
  })
})
