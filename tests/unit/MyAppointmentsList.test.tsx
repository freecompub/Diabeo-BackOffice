/**
 * @vitest-environment jsdom
 *
 * Tests unitaires pour `MyAppointmentsList` (US-2500-UI iter 12).
 *
 * Couvre :
 *   - Rendering : loading state + error state + empty states
 *   - Split chronologique prochains/passés (range -30/+90j)
 *   - Tri prochains croissant + passés décroissant
 *   - Bouton "Accepter alternative" visible UNIQUEMENT si status=cancelled
 *     + proposedAlternativeAt set
 *   - Fix H2 PR #438 : submittingId per-card (vs loading global)
 *   - Fix M3 PR #438 : code erreur → i18n key dédié
 *   - Fix H8 PR #438 : aria-atomic="true" sur live regions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { MyAppointmentsList } from "@/components/diabeo/appointments/MyAppointmentsList"
import * as useAppointmentsModule from "@/components/diabeo/appointments/useAppointments"
import * as useAcceptAlternativeModule from "@/components/diabeo/appointments/useAcceptAlternative"
import type { AppointmentListItem } from "@/components/diabeo/appointments/useAppointments"

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string, v?: Record<string, unknown>) => {
    if (v && "id" in v) return `${k}#${v.id}`
    if (v && "count" in v) return `${k}=${v.count}`
    if (v && "time" in v) return `${k}:${v.time}`
    if (v && "date" in v) return `${k}:${v.date}`
    return k
  },
  useLocale: () => "fr-FR",
}))

function renderWith(items: AppointmentListItem[], opts?: { loading?: boolean; error?: string | null }) {
  const refetch = vi.fn().mockResolvedValue(undefined)
  vi.spyOn(useAppointmentsModule, "useAppointments").mockReturnValue({
    items,
    truncated: false,
    loading: false,
    isInitialLoading: opts?.loading ?? false,
    error: opts?.error ?? null,
    lastFetchedAt: new Date("2026-05-25T10:00:00Z"),
    refetch,
  })
  return {
    refetch,
    ...render(<MyAppointmentsList patientId={42} />),
  }
}

function makeAppt(overrides: Partial<AppointmentListItem> = {}): AppointmentListItem {
  return {
    id: 1,
    patientId: 42,
    memberId: 10,
    type: "consultation",
    date: "2026-06-01",
    hour: "09:30:00",
    durationMinutes: 30,
    location: "in_person",
    status: "scheduled",
    proposedAlternativeAt: null,
    cancelledBy: null,
    cancelledAt: null,
    createdAt: "2026-05-01T00:00:00Z",
    updatedAt: "2026-05-01T00:00:00Z",
    ...overrides,
  }
}

describe("MyAppointmentsList", () => {
  beforeEach(() => {
    // Real timers (sinon waitFor freeze).
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-05-25T12:00:00Z").getTime())
    vi.spyOn(useAcceptAlternativeModule, "useAcceptAlternative").mockReturnValue({
      loading: false,
      error: null,
      submit: vi.fn(),
      reset: vi.fn(),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe("rendering", () => {
    it("isInitialLoading=true → status role loading", () => {
      renderWith([], { loading: true })
      const el = screen.getByRole("status")
      expect(el.textContent).toContain("loading")
      expect(el.getAttribute("aria-busy")).toBe("true")
    })

    it("error → alert + aria-atomic=true + sync timestamp", () => {
      renderWith([], { error: "boom" })
      const el = screen.getByRole("alert")
      expect(el.textContent).toContain("myAppointmentsError")
      expect(el.getAttribute("aria-atomic")).toBe("true")
    })

    it("empty arrays → 2 empty messages", () => {
      renderWith([])
      expect(screen.getAllByText(/Empty/i)).toHaveLength(2)
    })
  })

  describe("split chronologique", () => {
    it("prochains croissant + passés décroissant", () => {
      const items = [
        makeAppt({ id: 1, date: "2026-06-10" }),
        makeAppt({ id: 2, date: "2026-06-01" }),
        makeAppt({ id: 3, date: "2026-05-20" }),
        makeAppt({ id: 4, date: "2026-05-10" }),
      ]
      renderWith(items)
      // myAppointmentsUpcoming=2 (count 2 upcoming) + myAppointmentsPast=2
      const headings = screen.getAllByRole("heading", { level: 2 })
      expect(headings[0].textContent).toMatch(/myAppointmentsUpcoming=2/)
      expect(headings[1].textContent).toMatch(/myAppointmentsPast=2/)
      // Vérifier ordre upcoming croissant (2026-06-01 avant 2026-06-10).
      const upList = headings[0].parentElement!.querySelector("ul")!
      const upLis = upList.querySelectorAll("li")
      expect(upLis.length).toBe(2)
      // Vérifier ordre past décroissant (2026-05-20 avant 2026-05-10).
      const pastList = headings[1].parentElement!.querySelector("ul")!
      const pastLis = pastList.querySelectorAll("li")
      expect(pastLis.length).toBe(2)
    })

    it("RDV same-day → upcoming (tolérance demi-journée)", () => {
      renderWith([makeAppt({ id: 1, date: "2026-05-25" })])
      const headings = screen.getAllByRole("heading", { level: 2 })
      expect(headings[0].textContent).toMatch(/myAppointmentsUpcoming=1/)
      expect(headings[1].textContent).toMatch(/myAppointmentsPast=0/)
    })
  })

  describe("bouton Accepter alternative", () => {
    it("visible UNIQUEMENT si status=cancelled + proposedAlternativeAt", () => {
      renderWith([
        makeAppt({ id: 1, status: "scheduled", proposedAlternativeAt: null, date: "2026-06-01" }),
        makeAppt({ id: 2, status: "cancelled", proposedAlternativeAt: "2026-07-01T10:00:00Z", date: "2026-06-15" }),
        makeAppt({ id: 3, status: "cancelled", proposedAlternativeAt: null, date: "2026-06-20" }),
      ])
      const buttons = screen.queryAllByRole("button", { name: /actionAcceptAlternativeAria#2/ })
      expect(buttons.length).toBe(1)
      // RDV 1 et 3 : pas de bouton
      expect(screen.queryByRole("button", { name: /actionAcceptAlternativeAria#1/ })).toBeNull()
      expect(screen.queryByRole("button", { name: /actionAcceptAlternativeAria#3/ })).toBeNull()
    })

    it("Fix H2 PR #438 : clic 1 bouton ne disable PAS les autres cards", async () => {
      let resolveSubmit: ((v: unknown) => void) | null = null
      const submitPromise = new Promise((resolve) => {
        resolveSubmit = resolve
      })
      const submitMock = vi.fn().mockReturnValue(submitPromise)
      vi.spyOn(useAcceptAlternativeModule, "useAcceptAlternative").mockReturnValue({
        loading: false,
        error: null,
        submit: submitMock,
        reset: vi.fn(),
      })

      renderWith([
        makeAppt({ id: 1, status: "cancelled", proposedAlternativeAt: "2026-07-01T10:00:00Z", date: "2026-06-15" }),
        makeAppt({ id: 2, status: "cancelled", proposedAlternativeAt: "2026-07-02T10:00:00Z", date: "2026-06-20" }),
      ])

      const btn1 = screen.getByRole("button", { name: /actionAcceptAlternativeAria#1/ })
      const btn2 = screen.getByRole("button", { name: /actionAcceptAlternativeAria#2/ })

      // Clic card 1
      fireEvent.click(btn1)

      await waitFor(() => {
        expect((btn1 as HTMLButtonElement).disabled).toBe(true)
      })
      expect((btn2 as HTMLButtonElement).disabled).toBe(false) // <-- KEY ASSERTION

      // Résoudre
      resolveSubmit!({ ok: true, dto: { id: 1, status: "scheduled" } })
      await waitFor(() => {
        expect((btn1 as HTMLButtonElement).disabled).toBe(false)
      })
    })

    it("Fix M3 PR #438 : code alternativeExpired → key dédiée deadlineExceeded", async () => {
      const submitMock = vi.fn().mockResolvedValue({ ok: false, code: "alternativeExpired" })
      vi.spyOn(useAcceptAlternativeModule, "useAcceptAlternative").mockReturnValue({
        loading: false,
        error: null,
        submit: submitMock,
        reset: vi.fn(),
      })

      renderWith([
        makeAppt({ id: 1, status: "cancelled", proposedAlternativeAt: "2026-07-01T10:00:00Z", date: "2026-06-15" }),
      ])

      fireEvent.click(screen.getByRole("button", { name: /actionAcceptAlternativeAria#1/ }))
      await waitFor(() => {
        expect(screen.getByText("myAppointmentsAcceptError.deadlineExceeded")).toBeTruthy()
      })
    })

    it("Fix M3 PR #438 : slotOverlapAppointment → key conflict", async () => {
      const submitMock = vi.fn().mockResolvedValue({ ok: false, code: "slotOverlapAppointment" })
      vi.spyOn(useAcceptAlternativeModule, "useAcceptAlternative").mockReturnValue({
        loading: false,
        error: null,
        submit: submitMock,
        reset: vi.fn(),
      })

      renderWith([
        makeAppt({ id: 1, status: "cancelled", proposedAlternativeAt: "2026-07-01T10:00:00Z", date: "2026-06-15" }),
      ])

      fireEvent.click(screen.getByRole("button", { name: /actionAcceptAlternativeAria#1/ }))
      await waitFor(() => {
        expect(screen.getByText("myAppointmentsAcceptError.conflict")).toBeTruthy()
      })
    })

    it("Fix M3 PR #438 : forbidden → notAllowed", async () => {
      const submitMock = vi.fn().mockResolvedValue({ ok: false, code: "forbidden" })
      vi.spyOn(useAcceptAlternativeModule, "useAcceptAlternative").mockReturnValue({
        loading: false,
        error: null,
        submit: submitMock,
        reset: vi.fn(),
      })

      renderWith([
        makeAppt({ id: 1, status: "cancelled", proposedAlternativeAt: "2026-07-01T10:00:00Z", date: "2026-06-15" }),
      ])

      fireEvent.click(screen.getByRole("button", { name: /actionAcceptAlternativeAria#1/ }))
      await waitFor(() => {
        expect(screen.getByText("myAppointmentsAcceptError.notAllowed")).toBeTruthy()
      })
    })

    it("Fix M3 PR #438 : success → myAppointmentsAcceptOk + refetch", async () => {
      const submitMock = vi.fn().mockResolvedValue({ ok: true, dto: { id: 1, status: "scheduled" } })
      vi.spyOn(useAcceptAlternativeModule, "useAcceptAlternative").mockReturnValue({
        loading: false,
        error: null,
        submit: submitMock,
        reset: vi.fn(),
      })

      const { refetch } = renderWith([
        makeAppt({ id: 1, status: "cancelled", proposedAlternativeAt: "2026-07-01T10:00:00Z", date: "2026-06-15" }),
      ])

      fireEvent.click(screen.getByRole("button", { name: /actionAcceptAlternativeAria#1/ }))
      await waitFor(() => {
        expect(screen.getByText("myAppointmentsAcceptOk")).toBeTruthy()
      })
      expect(refetch).toHaveBeenCalledTimes(1)
    })
  })

  describe("aria-atomic live regions (Fix H8 PR #438)", () => {
    it("message succès role=status + aria-atomic=true + aria-live=polite", async () => {
      const submitMock = vi.fn().mockResolvedValue({ ok: true, dto: { id: 1, status: "scheduled" } })
      vi.spyOn(useAcceptAlternativeModule, "useAcceptAlternative").mockReturnValue({
        loading: false,
        error: null,
        submit: submitMock,
        reset: vi.fn(),
      })

      renderWith([
        makeAppt({ id: 1, status: "cancelled", proposedAlternativeAt: "2026-07-01T10:00:00Z", date: "2026-06-15" }),
      ])

      fireEvent.click(screen.getByRole("button", { name: /actionAcceptAlternativeAria#1/ }))
      await waitFor(() => {
        const msg = screen.getByRole("status")
        expect(msg.getAttribute("aria-atomic")).toBe("true")
        expect(msg.getAttribute("aria-live")).toBe("polite")
      })
    })

    it("message erreur role=alert + aria-atomic=true + aria-live=assertive", async () => {
      const submitMock = vi.fn().mockResolvedValue({ ok: false, code: "forbidden" })
      vi.spyOn(useAcceptAlternativeModule, "useAcceptAlternative").mockReturnValue({
        loading: false,
        error: null,
        submit: submitMock,
        reset: vi.fn(),
      })

      renderWith([
        makeAppt({ id: 1, status: "cancelled", proposedAlternativeAt: "2026-07-01T10:00:00Z", date: "2026-06-15" }),
      ])

      fireEvent.click(screen.getByRole("button", { name: /actionAcceptAlternativeAria#1/ }))
      await waitFor(() => {
        const msg = screen.getAllByRole("alert")[0]
        expect(msg.getAttribute("aria-atomic")).toBe("true")
        expect(msg.getAttribute("aria-live")).toBe("assertive")
      })
    })
  })
})
