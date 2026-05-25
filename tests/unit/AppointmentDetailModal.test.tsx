/**
 * @vitest-environment jsdom
 *
 * Tests unitaires pour le composant `<AppointmentDetailModal>`.
 *
 * US-2500-UI iter 5 — couvre :
 *   - Loading state (detail=null + loading=true)
 *   - Error state (detail=null + error set)
 *   - View mode : afficher détails déchiffrés + boutons selon statut + rôle
 *   - Cancel sub-mode : form actor + reason + POST /cancel
 *   - ProposeAlt sub-mode : form date+time + POST /propose-alternative
 *   - RBAC : bouton "Proposer alternative" caché pour NURSE
 *   - Status-gating : actions cachées si status ∈ {cancelled, completed, no_show}
 *   - 401 sur action → redirect login
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { AppointmentDetailModal } from "@/components/diabeo/appointments/AppointmentDetailModal"
import type { AppointmentDetail } from "@/components/diabeo/appointments/useAppointmentDetail"

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string, v?: Record<string, unknown>) => {
    if (v && "id" in v) return `${k}#${v.id}`
    if (v && "count" in v) return `${k}=${v.count}`
    return k
  },
}))

const baseDetail: AppointmentDetail = {
  id: 42,
  patientId: 7,
  memberId: 1,
  type: "diabeto",
  date: "2026-05-25",
  hour: "09:30:00",
  durationMinutes: 30,
  location: "in_person",
  status: "confirmed",
  motif: "Titration basale post-hypos",
  note: null,
  proposedAlternativeAt: null,
  cancelledBy: null,
  cancelReason: null,
  cancelledAt: null,
  createdAt: "2026-05-20T10:00:00Z",
  updatedAt: "2026-05-20T10:00:00Z",
}

function makeState(overrides: Partial<{
  detail: AppointmentDetail | null
  loading: boolean
  error: string | null
}> = {}) {
  return {
    detail: baseDetail,
    loading: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  }
}

const originalLocation = window.location

beforeEach(() => {
  Object.defineProperty(window, "location", {
    writable: true,
    configurable: true,
    value: { href: "/appointments" },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  Object.defineProperty(window, "location", {
    writable: true,
    configurable: true,
    value: originalLocation,
  })
})

describe("<AppointmentDetailModal>", () => {
  const onClose = vi.fn()
  const onActionSuccess = vi.fn()

  beforeEach(() => {
    onClose.mockClear()
    onActionSuccess.mockClear()
  })

  describe("Loading / error states", () => {
    it("loading + pas de detail → status role + i18n loading", () => {
      render(
        <AppointmentDetailModal
          state={makeState({ detail: null, loading: true })}
          openId={42}
          onClose={onClose}
          onActionSuccess={onActionSuccess}
          userRole="DOCTOR"
        />,
      )
      expect(screen.getByRole("status")).toBeTruthy()
    })

    it("error + pas de detail → alert role + message i18n", () => {
      render(
        <AppointmentDetailModal
          state={makeState({ detail: null, error: "notFound" })}
          openId={42}
          onClose={onClose}
          onActionSuccess={onActionSuccess}
          userRole="DOCTOR"
        />,
      )
      expect(screen.getByRole("alert")).toBeTruthy()
    })
  })

  describe("View mode — affichage détail", () => {
    it("affiche motif déchiffré + badge status + boutons selon status actionable + rôle DOCTOR", () => {
      render(
        <AppointmentDetailModal
          state={makeState()}
          openId={42}
          onClose={onClose}
          onActionSuccess={onActionSuccess}
          userRole="DOCTOR"
        />,
      )
      // Motif déchiffré visible
      expect(screen.getByText(/Titration basale/)).toBeTruthy()
      // Status badge
      expect(screen.getByText("status.confirmed")).toBeTruthy()
      // Boutons : annuler + proposer + fermer (DOCTOR sur status confirmed)
      expect(screen.getByText("actionCancel")).toBeTruthy()
      expect(screen.getByText("actionProposeAlternative")).toBeTruthy()
      expect(screen.getByText("actionClose")).toBeTruthy()
    })

    it("RBAC : bouton 'Proposer alternative' CACHÉ pour NURSE", () => {
      render(
        <AppointmentDetailModal
          state={makeState()}
          openId={42}
          onClose={onClose}
          onActionSuccess={onActionSuccess}
          userRole="NURSE"
        />,
      )
      expect(screen.getByText("actionCancel")).toBeTruthy()
      expect(screen.queryByText("actionProposeAlternative")).toBeNull()
    })

    it("Status-gating : pas de boutons action si status=cancelled", () => {
      render(
        <AppointmentDetailModal
          state={makeState({
            detail: {
              ...baseDetail,
              status: "cancelled",
              cancelledAt: "2026-05-23T10:00:00Z",
              cancelledBy: "professional",
              cancelReason: "Patient malade",
            },
          })}
          openId={42}
          onClose={onClose}
          onActionSuccess={onActionSuccess}
          userRole="DOCTOR"
        />,
      )
      expect(screen.queryByText("actionCancel")).toBeNull()
      expect(screen.queryByText("actionProposeAlternative")).toBeNull()
      expect(screen.getByText("actionClose")).toBeTruthy()
      // Détail annulation affiché
      expect(screen.getByText("cancelReasonLabel")).toBeTruthy()
      expect(screen.getByText(/Patient malade/)).toBeTruthy()
    })

    it("Status-gating : pas de boutons action si status=completed", () => {
      render(
        <AppointmentDetailModal
          state={makeState({ detail: { ...baseDetail, status: "completed" } })}
          openId={42}
          onClose={onClose}
          onActionSuccess={onActionSuccess}
          userRole="DOCTOR"
        />,
      )
      expect(screen.queryByText("actionCancel")).toBeNull()
      expect(screen.queryByText("actionProposeAlternative")).toBeNull()
    })

    it("clic 'Fermer' → onClose appelé", () => {
      render(
        <AppointmentDetailModal
          state={makeState()}
          openId={42}
          onClose={onClose}
          onActionSuccess={onActionSuccess}
          userRole="DOCTOR"
        />,
      )
      fireEvent.click(screen.getByText("actionClose"))
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it("lien patient → href /patients/{id} (rendu dans Portal Dialog)", () => {
      render(
        <AppointmentDetailModal
          state={makeState()}
          openId={42}
          onClose={onClose}
          onActionSuccess={onActionSuccess}
          userRole="DOCTOR"
        />,
      )
      // Dialog rend dans un Portal attaché à document.body — on cherche
      // dans le document complet, pas le container du render.
      const link = document.querySelector('a[href="/patients/7"]')
      expect(link).not.toBeNull()
    })
  })

  describe("Cancel sub-mode", () => {
    it("clic 'Annuler' → entrée sub-mode cancel + form rendu", () => {
      render(
        <AppointmentDetailModal
          state={makeState()}
          openId={42}
          onClose={onClose}
          onActionSuccess={onActionSuccess}
          userRole="DOCTOR"
        />,
      )
      fireEvent.click(screen.getByText("actionCancel"))
      expect(screen.getByText("cancelTitle")).toBeTruthy()
      expect(screen.getByLabelText("cancelReasonLabel")).toBeTruthy()
      expect(screen.getByText("actorDoctor")).toBeTruthy()
      expect(screen.getByText("actorPatient")).toBeTruthy()
    })

    it("submit form cancel → POST /cancel avec body conforme + onActionSuccess + onClose", async () => {
      const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({ ...baseDetail, status: "cancelled" }),
      } as Response)

      render(
        <AppointmentDetailModal
          state={makeState()}
          openId={42}
          onClose={onClose}
          onActionSuccess={onActionSuccess}
          userRole="DOCTOR"
        />,
      )
      fireEvent.click(screen.getByText("actionCancel"))

      // Saisir reason
      const textarea = screen.getByLabelText("cancelReasonLabel") as HTMLTextAreaElement
      fireEvent.change(textarea, { target: { value: "Patient injoignable" } })

      // Submit
      fireEvent.click(screen.getByText("actionConfirmCancel"))

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          "/api/appointments/42/cancel",
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({ actor: "doctor", reason: "Patient injoignable" }),
          }),
        )
      })
      expect(onActionSuccess).toHaveBeenCalledTimes(1)
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it("submit cancel sans reason → body sans reason (optional)", async () => {
      const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({}),
      } as Response)

      render(
        <AppointmentDetailModal
          state={makeState()}
          openId={42}
          onClose={onClose}
          onActionSuccess={onActionSuccess}
          userRole="DOCTOR"
        />,
      )
      fireEvent.click(screen.getByText("actionCancel"))
      fireEvent.click(screen.getByText("actionConfirmCancel"))

      await waitFor(() => expect(fetchMock).toHaveBeenCalled())
      const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)
      expect(body.actor).toBe("doctor")
      expect(body.reason).toBeUndefined()
    })

    it("cancel form 401 → redirect /login?expired=1", async () => {
      vi.spyOn(global, "fetch").mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: "tokenExpired" }),
      } as Response)

      render(
        <AppointmentDetailModal
          state={makeState()}
          openId={42}
          onClose={onClose}
          onActionSuccess={onActionSuccess}
          userRole="DOCTOR"
        />,
      )
      fireEvent.click(screen.getByText("actionCancel"))
      fireEvent.click(screen.getByText("actionConfirmCancel"))

      await waitFor(() => {
        expect(window.location.href).toBe("/login?expired=1")
      })
      // onActionSuccess NON appelé (auth perdue).
      expect(onActionSuccess).not.toHaveBeenCalled()
    })

    it("clic 'Retour' depuis cancel → revient au view mode", () => {
      render(
        <AppointmentDetailModal
          state={makeState()}
          openId={42}
          onClose={onClose}
          onActionSuccess={onActionSuccess}
          userRole="DOCTOR"
        />,
      )
      fireEvent.click(screen.getByText("actionCancel"))
      expect(screen.getByText("cancelTitle")).toBeTruthy()
      fireEvent.click(screen.getByText("actionBack"))
      expect(screen.queryByText("cancelTitle")).toBeNull()
      // Status badge re-visible (view mode).
      expect(screen.getByText("status.confirmed")).toBeTruthy()
    })
  })

  describe("ProposeAlternative sub-mode (DOCTOR only)", () => {
    it("submit form proposeAlt → POST /propose-alternative avec alternativeAt ISO", async () => {
      const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({ ...baseDetail, proposedAlternativeAt: "2026-06-01T10:00:00Z" }),
      } as Response)

      render(
        <AppointmentDetailModal
          state={makeState()}
          openId={42}
          onClose={onClose}
          onActionSuccess={onActionSuccess}
          userRole="DOCTOR"
        />,
      )
      fireEvent.click(screen.getByText("actionProposeAlternative"))

      // Form pre-rempli avec date du RDV courant (2026-05-25 09:30).
      const dateInput = screen.getByLabelText("dateLabel") as HTMLInputElement
      const timeInput = screen.getByLabelText("hourLabel") as HTMLInputElement
      expect(dateInput.value).toBe("2026-05-25")
      expect(timeInput.value).toBe("09:30")

      // Change date+time
      fireEvent.change(dateInput, { target: { value: "2026-06-01" } })
      fireEvent.change(timeInput, { target: { value: "14:00" } })
      fireEvent.click(screen.getByText("actionConfirmPropose"))

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          "/api/appointments/42/propose-alternative",
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({ alternativeAt: "2026-06-01T14:00:00" }),
          }),
        )
      })
      expect(onActionSuccess).toHaveBeenCalledTimes(1)
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  describe("openId / open state coupling", () => {
    it("openId=null → modal not rendered (Dialog open=false → content hidden)", () => {
      const { container } = render(
        <AppointmentDetailModal
          state={makeState({ detail: null })}
          openId={null}
          onClose={onClose}
          onActionSuccess={onActionSuccess}
          userRole="DOCTOR"
        />,
      )
      // Pas de motif visible (Dialog overlay non rendu).
      expect(container.textContent).not.toContain("Titration basale")
    })
  })
})
