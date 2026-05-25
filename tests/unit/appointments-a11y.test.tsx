/**
 * @vitest-environment jsdom
 *
 * Tests a11y US-2500-UI iter 10 polish — vérifications des landmarks
 * ARIA, skip-link, aria-busy + heading hierarchy sur la page calendar.
 *
 * Couvre :
 *   - skip-link visible au focus (WCAG 2.4.1 Bypass Blocks AA)
 *   - landmark region calendar avec aria-label (Schedule-X v4 ne fournit
 *     pas de landmark natif sur son outer wrapper)
 *   - aria-busy lié à isInitialLoading du hook
 *   - heading hierarchy h1 page + h2 sections
 *   - id="appointment-calendar-main" cible du skip-link
 */

import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) => k,
  useLocale: () => "fr-FR",
}))

// Mock Schedule-X — on teste le wrapper a11y, pas le rendu Schedule-X
vi.mock("@schedule-x/react", () => ({
  ScheduleXCalendar: () => <div data-testid="schedule-x-mock" />,
  useNextCalendarApp: () => ({}),
}))
vi.mock("@schedule-x/calendar", () => ({
  createViewMonthGrid: () => ({}),
  createViewWeek: () => ({}),
  createViewDay: () => ({}),
}))
vi.mock("@schedule-x/events-service", () => ({
  createEventsServicePlugin: () => ({ set: vi.fn() }),
}))
vi.mock("@schedule-x/drag-and-drop", () => ({
  createDragAndDropPlugin: () => ({}),
}))

// Mock hooks pour contrôler isInitialLoading
const mockUseAppointments = vi.fn()
vi.mock("@/components/diabeo/appointments/useAppointments", () => ({
  useAppointments: (...args: unknown[]) => mockUseAppointments(...args),
}))
const mockUseMyMemberships = vi.fn()
vi.mock("@/components/diabeo/appointments/useMyMemberships", () => ({
  useMyMemberships: () => mockUseMyMemberships(),
}))
vi.mock("@/components/diabeo/appointments/useAppointmentDetail", () => ({
  useAppointmentDetail: () => ({ detail: null, loading: false, error: null, refetch: vi.fn() }),
}))
vi.mock("@/components/diabeo/appointments/AppointmentDetailModal", () => ({
  AppointmentDetailModal: () => null,
}))
vi.mock("@/components/diabeo/appointments/AppointmentCreateModal", () => ({
  AppointmentCreateModal: () => null,
}))
vi.mock("@/components/diabeo/appointments/useUpdateAppointment", () => ({
  useUpdateAppointment: () => ({
    loading: false, error: null, submit: vi.fn(), reset: vi.fn(),
  }),
}))

const { AppointmentCalendar } = await import(
  "@/components/diabeo/appointments/AppointmentCalendar"
)

function setUpMocks(opts: {
  isInitialLoading?: boolean
  scopeMissing?: boolean
} = {}) {
  mockUseMyMemberships.mockReturnValue({
    items: opts.scopeMissing ? [] : [{
      memberId: 1, memberName: "Dr Test", serviceId: 1,
      serviceName: "Test Service", establishment: "CHU",
    }],
    loading: false,
    error: null,
    refetch: vi.fn(),
  })
  mockUseAppointments.mockReturnValue({
    items: [],
    truncated: false,
    loading: false,
    isInitialLoading: opts.isInitialLoading ?? false,
    error: null,
    lastFetchedAt: new Date(),
    refetch: vi.fn(),
  })
}

describe("US-2500-UI iter 10 a11y polish", () => {
  it("landmark region calendar avec id et aria-label", () => {
    setUpMocks()
    const { container } = render(<AppointmentCalendar userRole="DOCTOR" />)
    const region = container.querySelector("#appointment-calendar-main")
    expect(region).not.toBeNull()
    expect(region!.getAttribute("role")).toBe("region")
    expect(region!.getAttribute("aria-label")).toBe("calendarMainLabel")
  })

  it("aria-busy='true' pendant isInitialLoading", () => {
    setUpMocks({ isInitialLoading: true })
    const { container } = render(<AppointmentCalendar userRole="DOCTOR" />)
    const region = container.querySelector("#appointment-calendar-main")
    expect(region!.getAttribute("aria-busy")).toBe("true")
  })

  it("aria-busy='false' après chargement initial", () => {
    setUpMocks({ isInitialLoading: false })
    const { container } = render(<AppointmentCalendar userRole="DOCTOR" />)
    const region = container.querySelector("#appointment-calendar-main")
    expect(region!.getAttribute("aria-busy")).toBe("false")
  })

  it("focus-visible:ring sur le wrapper calendar (WCAG 2.4.7)", () => {
    setUpMocks()
    const { container } = render(<AppointmentCalendar userRole="DOCTOR" />)
    const region = container.querySelector("#appointment-calendar-main")
    expect(region!.className).toContain("focus-visible:ring-2")
  })

  it("scopeMissing path : id+role region cohérent pour skip-link", () => {
    setUpMocks({ scopeMissing: true })
    const { container } = render(<AppointmentCalendar userRole="DOCTOR" />)
    const region = container.querySelector("#appointment-calendar-main")
    expect(region).not.toBeNull()
    expect(region!.getAttribute("role")).toBe("region")
    // En scopeMissing, on garde l'id pour que le skip-link page atteigne
    // la zone "Sélectionnez un membre" cohérent UX.
    // Mock memberships=[] → scopeMissingTitleKey="scopeMissingTitle"
    // (vs "scopeChooseTitle" si >= 2 memberships).
    expect(screen.getByText("scopeMissingTitle")).toBeTruthy()
  })

  it("h2 heading dans scopeMissing path (hierarchy correcte)", () => {
    setUpMocks({ scopeMissing: true })
    const { container } = render(<AppointmentCalendar userRole="DOCTOR" />)
    const h2 = container.querySelector("h2")
    expect(h2).not.toBeNull()
  })

  it("tabIndex=-1 sur la région calendar (programmatically focusable pour skip-link)", () => {
    setUpMocks()
    const { container } = render(<AppointmentCalendar userRole="DOCTOR" />)
    const region = container.querySelector("#appointment-calendar-main")
    // tabIndex=-1 = pas dans le Tab order naturel MAIS focusable
    // programmatiquement (skip-link.focus() ou href="#id" déplace focus).
    expect(region!.getAttribute("tabindex")).toBe("-1")
  })
})
