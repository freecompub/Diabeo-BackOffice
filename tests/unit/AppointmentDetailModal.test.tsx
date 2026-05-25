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
  // Fix FE-1/HSA-5 round 1 review PR #433 — `useLocale` désormais utilisé
  // par ViewMode pour cohérence next-intl (vs `navigator.language`).
  useLocale: () => "fr-FR",
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

  describe("Round 1 review fixes — couverture incrémentale", () => {
    it("FE-14 — submitProposeAlt 401 → redirect /login?expired=1 (parité avec cancel)", async () => {
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
      fireEvent.click(screen.getByText("actionProposeAlternative"))
      fireEvent.click(screen.getByText("actionConfirmPropose"))

      await waitFor(() => {
        expect(window.location.href).toBe("/login?expired=1")
      })
      expect(onActionSuccess).not.toHaveBeenCalled()
    })

    it("M-7 — status no_show : pas de boutons action (status-gating completeness)", () => {
      render(
        <AppointmentDetailModal
          state={makeState({
            detail: { ...baseDetail, status: "no_show" },
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
    })

    it("H-1/FE-2 — guard double-submit : second clic ignoré pendant actionLoading", async () => {
      // Promise jamais résolue → loading persistant pendant le test.
      let resolveFn!: (v: Response) => void
      const pendingResponse = new Promise<Response>((resolve) => { resolveFn = resolve })
      const fetchMock = vi.spyOn(global, "fetch").mockReturnValue(pendingResponse)

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
      const submitBtn = screen.getByText("actionConfirmCancel")
      fireEvent.click(submitBtn) // 1er submit → fetch en cours
      fireEvent.click(submitBtn) // 2e submit → doit être ignoré (disabled + guard)
      fireEvent.click(submitBtn) // 3e submit → idem

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(1)
      })

      // Cleanup : resolve la promise pour ne pas leak entre tests
      resolveFn({ ok: true, json: async () => ({}) } as Response)
    })

    it("FE-9 — actionError ré-annoncé via key+aria-live=assertive sur retry", async () => {
      vi.spyOn(global, "fetch").mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: "serverError" }),
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
        const alert = screen.getByRole("alert")
        expect(alert.getAttribute("aria-live")).toBe("assertive")
      })
    })

    it("H-1 corollaire — change input clear actionError pour permettre re-submit", async () => {
      const fetchMock = vi.spyOn(global, "fetch")
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: async () => ({ error: "serverError" }),
        } as Response)
        .mockResolvedValueOnce({
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

      // 1er échec → alerte visible
      await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy())

      // Change textarea → clear error
      const textarea = screen.getByLabelText("cancelReasonLabel") as HTMLTextAreaElement
      fireEvent.change(textarea, { target: { value: "Nouvelle raison" } })
      expect(screen.queryByRole("alert")).toBeNull()

      // Re-submit → succès
      fireEvent.click(screen.getByText("actionConfirmCancel"))
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
      expect(onActionSuccess).toHaveBeenCalledTimes(1)
    })

    it("M-7/FE-12 corollaire — drafts reset entre sub-modes via remount sub-composant", () => {
      render(
        <AppointmentDetailModal
          state={makeState()}
          openId={42}
          onClose={onClose}
          onActionSuccess={onActionSuccess}
          userRole="DOCTOR"
        />,
      )
      // Ouvre cancel, tape reason
      fireEvent.click(screen.getByText("actionCancel"))
      const textarea1 = screen.getByLabelText("cancelReasonLabel") as HTMLTextAreaElement
      fireEvent.change(textarea1, { target: { value: "Patient injoignable" } })
      expect(textarea1.value).toBe("Patient injoignable")

      // Retour view
      fireEvent.click(screen.getByText("actionBack"))
      // Re-ouvre cancel → composant remonté, draft reset
      fireEvent.click(screen.getByText("actionCancel"))
      const textarea2 = screen.getByLabelText("cancelReasonLabel") as HTMLTextAreaElement
      expect(textarea2.value).toBe("")
    })

    it("L-5/FE-15 — touch targets radio actor ≥ 44px (WCAG 2.5.5)", () => {
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
      // Labels englobants doivent avoir min-h-[44px] via classe Tailwind.
      const labels = document.querySelectorAll("label.min-h-\\[44px\\]")
      expect(labels.length).toBeGreaterThanOrEqual(2)
    })

    it("HSA-2 — lien patient porte rel='noreferrer' (anti-Referer leak)", () => {
      render(
        <AppointmentDetailModal
          state={makeState()}
          openId={42}
          onClose={onClose}
          onActionSuccess={onActionSuccess}
          userRole="DOCTOR"
        />,
      )
      const link = document.querySelector('a[href="/patients/7"]')
      expect(link).not.toBeNull()
      expect(link!.getAttribute("rel")).toBe("noreferrer")
    })

    it("M-2 — pas de input hidden data-testid='appt-id' (debug reliquat retiré)", () => {
      render(
        <AppointmentDetailModal
          state={makeState()}
          openId={42}
          onClose={onClose}
          onActionSuccess={onActionSuccess}
          userRole="DOCTOR"
        />,
      )
      expect(document.querySelector("[data-testid='appt-id']")).toBeNull()
      expect(document.querySelector("input[type='hidden']")).toBeNull()
    })
  })

  describe("openId / open state coupling", () => {
    it("FE-11 — openId=null → Dialog non rendu (assertion stricte sur role=dialog vs textContent)", () => {
      render(
        <AppointmentDetailModal
          state={makeState({ detail: null })}
          openId={null}
          onClose={onClose}
          onActionSuccess={onActionSuccess}
          userRole="DOCTOR"
        />,
      )
      // Fix FE-11 round 1 — assertion sémantique sur le rôle ARIA dialog
      // (vs ancien `.not.toContain("Titration basale")` qui était faux-positif
      // facile car le motif n'est même pas dans le state quand detail=null).
      expect(document.querySelector('[role="dialog"]')).toBeNull()
    })
  })
})
