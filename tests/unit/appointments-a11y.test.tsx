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
  useTranslations: () => (k: string, v?: Record<string, unknown>) => {
    // Mock interpolate {date} param pour test A11Y-5 todayDateAnnouncement.
    if (v && "date" in v) return `${k}:${v.date}`
    return k
  },
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

  it("scopeMissing path : region cohérente (id renommé `-empty` par CR-1 fix round 1)", () => {
    setUpMocks({ scopeMissing: true })
    const { container } = render(<AppointmentCalendar userRole="DOCTOR" />)
    // Fix CR-1 round 1 — id distinct `-empty` (vs `-main`) pour éviter
    // duplicate id si futur refactor casse l'exclusion mutuelle des branches.
    const region = container.querySelector("#appointment-calendar-empty")
    expect(region).not.toBeNull()
    expect(region!.getAttribute("role")).toBe("region")
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

  /**
   * Fix CR-1/A11Y-3/HSA-6 round 1 review PR #437 — id distinct entre les 2
   * paths (scopeMissing vs normal) pour éviter risque duplicate id si futur
   * refactor casse l'exclusion mutuelle des branches conditionnelles.
   */
  it("Fix CR-1/A11Y-3 round 1 — id distinct '-empty' sur scopeMissing path (vs '-main' normal)", () => {
    setUpMocks({ scopeMissing: true })
    const { container } = render(<AppointmentCalendar userRole="DOCTOR" />)
    expect(container.querySelector("#appointment-calendar-empty")).not.toBeNull()
    expect(container.querySelector("#appointment-calendar-main")).toBeNull()
  })

  /**
   * Fix CR-2 round 1 review PR #437 — symétrie scopeMissing path
   * (tabIndex={-1} + focus-visible:ring) cohérent path normal.
   */
  it("Fix CR-2 round 1 — scopeMissing path : tabIndex=-1 + focus-visible:ring symétrique", () => {
    setUpMocks({ scopeMissing: true })
    const { container } = render(<AppointmentCalendar userRole="DOCTOR" />)
    const region = container.querySelector("#appointment-calendar-empty")
    expect(region!.getAttribute("tabindex")).toBe("-1")
    expect(region!.className).toContain("focus-visible:ring-2")
  })

  /**
   * Fix CR-4 round 1 review PR #437 — `aria-busy={isInitialLoading}` boolean
   * direct (React sérialise correctement). Pas de conversion manuelle.
   */
  it("Fix CR-4 round 1 — aria-busy boolean direct (React sérialise en 'true'/'false')", () => {
    setUpMocks({ isInitialLoading: true })
    const { container } = render(<AppointmentCalendar userRole="DOCTOR" />)
    const region = container.querySelector("#appointment-calendar-main")
    // React sérialise boolean en string DOM "true"/"false"
    expect(region!.getAttribute("aria-busy")).toBe("true")
  })

  /**
   * Fix A11Y-4 round 1 review PR #437 — aria-label contextuel pendant
   * isInitialLoading pour SR feedback informatif (vs annonce vague
   * "Calendrier occupé" sans contexte).
   */
  it("Fix A11Y-4 round 1 — aria-label inclut 'loading' pendant isInitialLoading", () => {
    setUpMocks({ isInitialLoading: true })
    const { container } = render(<AppointmentCalendar userRole="DOCTOR" />)
    const region = container.querySelector("#appointment-calendar-main")
    // Format: "{calendarMainLabel} — {loading}" → "calendarMainLabel — loading"
    expect(region!.getAttribute("aria-label")).toContain("loading")
    expect(region!.getAttribute("aria-label")).toContain("calendarMainLabel")
  })

  it("Fix A11Y-4 round 1 — aria-label revient à label simple après chargement", () => {
    setUpMocks({ isInitialLoading: false })
    const { container } = render(<AppointmentCalendar userRole="DOCTOR" />)
    const region = container.querySelector("#appointment-calendar-main")
    // Pas de "loading" suffix après le 1er fetch.
    expect(region!.getAttribute("aria-label")).toBe("calendarMainLabel")
  })

  /**
   * Fix A11Y-5 round 1 review PR #437 — SR-only annonce date du jour
   * (workaround Schedule-X v4 pas de `aria-current="date"` natif).
   */
  it("Fix A11Y-5 round 1 — annonce SR-only 'todayDateAnnouncement' avec date locale", () => {
    setUpMocks()
    const { container } = render(<AppointmentCalendar userRole="DOCTOR" />)
    const srOnly = container.querySelector("p.sr-only")
    expect(srOnly).not.toBeNull()
    // Mock i18n returns key name; le formatage Intl.DateTimeFormat est appliqué
    // sur la date réelle au mount → la chaîne contient au moins l'année courante.
    const year = new Date().getFullYear()
    expect(srOnly!.textContent).toContain(String(year))
  })
})
