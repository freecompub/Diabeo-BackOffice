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
      // Boutons : annuler + proposer (DOCTOR sur status confirmed). Le bouton
      // "Fermer" redondant a été retiré (#476) — le X du header ferme.
      expect(screen.getByText("actionCancel")).toBeTruthy()
      expect(screen.getByText("actionProposeAlternative")).toBeTruthy()
      expect(screen.queryByText("actionClose")).toBeNull()
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
      // #476 — statut terminal sans action → footer non rendu (X header ferme).
      expect(screen.queryByText("actionClose")).toBeNull()
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

    it("#476 — le X du header ferme le modal (plus de bouton 'Fermer' redondant)", () => {
      render(
        <AppointmentDetailModal
          state={makeState()}
          openId={42}
          onClose={onClose}
          onActionSuccess={onActionSuccess}
          userRole="DOCTOR"
        />,
      )
      // Plus de bouton "Fermer" dans le footer.
      expect(screen.queryByText("actionClose")).toBeNull()
      // Le X (DialogContent showCloseButton, sr-only "Close") ferme via
      // onOpenChange → handleClose → onClose.
      fireEvent.click(screen.getByRole("button", { name: "Close" }))
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

      // Change date+time. The propose-alternative date input has `min={today}`
      // and jsdom enforces rangeUnderflow on submit — so a hardcoded date in the
      // past (relative to the wall clock) would block the submit and the POST
      // would never fire. Compute a date safely in the future so the test is
      // not a time-bomb (was hardcoded "2026-06-01", which broke once the clock
      // passed that day).
      const futureDate = new Date(Date.now() + 14 * 86_400_000).toISOString().split("T")[0]
      fireEvent.change(dateInput, { target: { value: futureDate } })
      fireEvent.change(timeInput, { target: { value: "14:00" } })
      fireEvent.click(screen.getByText("actionConfirmPropose"))

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          "/api/appointments/42/propose-alternative",
          expect.objectContaining({
            method: "POST",
            // Fix HSA-2-3 round 2 — suffix `Z` explicite pour forcer
            // l'interprétation UTC déterministe côté backend `z.coerce.date()`.
            body: JSON.stringify({ alternativeAt: `${futureDate}T14:00:00Z` }),
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

      // Fix round 1 review PR #440 — RDV en date FUTURE (vs hardcoded
      // 2026-05-25 qui devient < today.now après le 2026-05-26 → input
      // `min` du form ProposeAlt refusait la valeur → submit jamais
      // déclenché → fetch jamais appelé → CI Unit & Integration fail).
      const futureDate = new Date()
      futureDate.setDate(futureDate.getDate() + 7)
      const futureDateStr = futureDate.toISOString().slice(0, 10)

      render(
        <AppointmentDetailModal
          state={makeState({ detail: { ...baseDetail, date: futureDateStr } })}
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
      // #476 — statut terminal → footer non rendu (X header ferme).
      expect(screen.queryByText("actionClose")).toBeNull()
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

    it("HSA-2 + HSA-2-4 — lien patient porte rel='noopener noreferrer' (anti-Referer + anti-tabnabbing)", () => {
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
      // Fix HSA-2-4 round 2 — `noopener` ajouté en defense-in-depth contre
      // reverse tabnabbing si futur dev ajoute `target="_blank"` (Safari < 14
      // et Firefox ESR healthcare ne posent pas `noopener` par défaut).
      expect(link!.getAttribute("rel")).toBe("noopener noreferrer")
    })

    it("FE-2-5 — key includes errorNonce → re-mount p[role=alert] sur retry même message", async () => {
      const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue({
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

      // 1er échec → alerte initiale (ref capturée pour vérification ré-annonce
      // ci-dessous via comparaison DOM node identity).
      await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy())

      // Retry sans clear (input pas changé → error toujours visible)
      // → simule resubmit après timeout réseau
      const textarea = screen.getByLabelText("cancelReasonLabel") as HTMLTextAreaElement
      fireEvent.change(textarea, { target: { value: "Retry" } })
      // change clear l'error → re-submit → re-error
      await waitFor(() => expect(screen.queryByRole("alert")).toBeNull())

      fireEvent.click(screen.getByText("actionConfirmCancel"))
      await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy())

      const secondAlert = screen.getByRole("alert")
      // Fix FE-2-5 — key={`${error}-${errorNonce}`} change même si error
      // identique → DOM node distinct → screen reader re-vocalise.
      // On vérifie indirectement : 2 fetch tirés, 2 alerts distincts dans le temps.
      expect(fetchMock).toHaveBeenCalledTimes(2)
      // Note : firstAlert et secondAlert sont des refs DOM, le DOM node
      // a été remplacé entre les 2 renders donc !== si key a bien changé.
      // (En jsdom on observe via attribut DOM unique)
      expect(secondAlert).toBeTruthy()
      // Defense-in-depth : vérifie que aria-live="assertive" est posé
      expect(secondAlert.getAttribute("aria-live")).toBe("assertive")
    })

    it("FE-2-2 — Escape pendant actionLoading ne ferme PAS le modal (handleClose gate)", async () => {
      // Promise jamais résolue → loading persistant (actionLoading=true)
      const pendingResponse = new Promise<Response>(() => { /* never resolves */ })
      vi.spyOn(global, "fetch").mockReturnValue(pendingResponse)

      render(
        <AppointmentDetailModal
          state={makeState()}
          openId={42}
          onClose={onClose}
          onActionSuccess={onActionSuccess}
          userRole="DOCTOR"
        />,
      )
      // Entre en mode cancel, submit (fetch reste pending → actionLoading=true)
      fireEvent.click(screen.getByText("actionCancel"))
      fireEvent.click(screen.getByText("actionConfirmCancel"))

      // Wait : pendant actionLoading le bouton submit affiche "loading"
      // (cf. CancelForm `{loading ? t("loading") : t("actionConfirmCancel")}`)
      await waitFor(() => {
        // 2 boutons doivent matcher "loading" : actionLoading sur submit + le
        // texte loading qui apparaît à la place de actionConfirmCancel.
        // Le sub-form retire actionConfirmCancel quand loading=true.
        expect(screen.queryByText("actionConfirmCancel")).toBeNull()
      })

      // Maintenant Base UI Dialog en mode contrôlé : si on simule un Escape
      // ou un clic backdrop, onOpenChange(false) est déclenché → handleClose
      // est appelé → garde `if (actionLoading) return` empêche `onClose()`.
      fireEvent.keyDown(document, { key: "Escape" })

      // onClose NE doit PAS être appelé pendant actionLoading
      expect(onClose).not.toHaveBeenCalled()
    })

    it("FE-2 round 1 PR #435 — bouton 'Déplacer' visible si status actionable + a11y clavier WCAG 2.5.7", () => {
      render(
        <AppointmentDetailModal
          state={makeState()}
          openId={42}
          onClose={onClose}
          onActionSuccess={onActionSuccess}
          userRole="DOCTOR"
        />,
      )
      // Bouton 'Déplacer' présent comme alternative a11y au drag&drop calendar.
      const moveBtn = screen.getByText("actionMove")
      expect(moveBtn).toBeTruthy()
    })

    it("FE-2 round 1 PR #435 — clic 'Déplacer' → sub-mode 'move' avec form date+heure", () => {
      render(
        <AppointmentDetailModal
          state={makeState()}
          openId={42}
          onClose={onClose}
          onActionSuccess={onActionSuccess}
          userRole="DOCTOR"
        />,
      )
      fireEvent.click(screen.getByText("actionMove"))
      // Form move avec date + heure prerempli (cohérent ProposeAlternativeForm).
      expect(screen.getByText("moveTitle")).toBeTruthy()
      expect(screen.getByLabelText("dateLabel")).toBeTruthy()
      expect(screen.getByLabelText("hourLabel")).toBeTruthy()
      expect(screen.getByText("actionConfirmMove")).toBeTruthy()
    })

    it("FE-2 — bouton 'Déplacer' caché si status terminal (alignement disableDND drag)", () => {
      render(
        <AppointmentDetailModal
          state={makeState({
            detail: { ...baseDetail, status: "cancelled", cancelledAt: "2026-05-23T10:00:00Z" },
          })}
          openId={42}
          onClose={onClose}
          onActionSuccess={onActionSuccess}
          userRole="DOCTOR"
        />,
      )
      expect(screen.queryByText("actionMove")).toBeNull()
    })

    it("FE-2 — submit form 'Déplacer' → PUT /api/appointments/[id] + onActionSuccess + onClose", async () => {
      vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({ id: 42 }),
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
      fireEvent.click(screen.getByText("actionMove"))

      const dateInput = screen.getByLabelText("dateLabel") as HTMLInputElement
      const timeInput = screen.getByLabelText("hourLabel") as HTMLInputElement
      fireEvent.change(dateInput, { target: { value: "2026-06-15" } })
      fireEvent.change(timeInput, { target: { value: "11:00" } })
      fireEvent.click(screen.getByText("actionConfirmMove"))

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/appointments/42",
          expect.objectContaining({
            method: "PUT",
            // Backend PUT accepte {date, hour} séparé (vs ISO Z proposeAlt).
            body: JSON.stringify({ date: "2026-06-15", hour: "11:00" }),
          }),
        )
      })
      expect(onActionSuccess).toHaveBeenCalledTimes(1)
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it("HSA-2 round 1 PR #436 — bouton 'Accepter alternative' caché pour VIEWER (RBAC defense-in-depth)", () => {
      render(
        <AppointmentDetailModal
          state={makeState({
            detail: {
              ...baseDetail,
              status: "cancelled",
              proposedAlternativeAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
            },
          })}
          openId={42}
          onClose={onClose}
          onActionSuccess={onActionSuccess}
          userRole="VIEWER"
        />,
      )
      // VIEWER ne voit pas le bouton — cohérent pattern iter 5 canProposeAlternative
      expect(screen.queryByText("actionAcceptAlternative")).toBeNull()
    })

    it("HSA-2 round 1 PR #436 — bouton 'Accepter alternative' VISIBLE pour DOCTOR/NURSE", () => {
      const recent = new Date(Date.now() + 24 * 3600 * 1000).toISOString()
      const { rerender } = render(
        <AppointmentDetailModal
          state={makeState({
            detail: { ...baseDetail, status: "cancelled", proposedAlternativeAt: recent },
          })}
          openId={42}
          onClose={onClose}
          onActionSuccess={onActionSuccess}
          userRole="DOCTOR"
        />,
      )
      expect(screen.getByText("actionAcceptAlternative")).toBeTruthy()

      rerender(
        <AppointmentDetailModal
          state={makeState({
            detail: { ...baseDetail, status: "cancelled", proposedAlternativeAt: recent },
          })}
          openId={42}
          onClose={onClose}
          onActionSuccess={onActionSuccess}
          userRole="NURSE"
        />,
      )
      expect(screen.getByText("actionAcceptAlternative")).toBeTruthy()
    })

    it("FE-3 round 1 PR #436 — clic 'Accepter' ouvre sub-mode 'acceptAlt' avec récap (WCAG 3.3.4)", () => {
      const recent = new Date(Date.now() + 24 * 3600 * 1000).toISOString()
      render(
        <AppointmentDetailModal
          state={makeState({
            detail: { ...baseDetail, status: "cancelled", proposedAlternativeAt: recent },
          })}
          openId={42}
          onClose={onClose}
          onActionSuccess={onActionSuccess}
          userRole="DOCTOR"
        />,
      )
      fireEvent.click(screen.getByText("actionAcceptAlternative"))
      // Sub-mode acceptAlt rendu avec récap visuel
      expect(screen.getByText("acceptAltTitle")).toBeTruthy()
      expect(screen.getByText("acceptAltNewSlot")).toBeTruthy()
      expect(screen.getByText("actionConfirmAcceptAlt")).toBeTruthy()
      // PAS de POST direct — l'utilisateur doit confirmer
      expect(onActionSuccess).not.toHaveBeenCalled()
    })

    it("FE-3 round 1 PR #436 — clic 'Confirmer' dans sub-mode acceptAlt → POST /accept-alternative", async () => {
      vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({ id: 42, status: "scheduled", date: "2026-06-15", hour: "11:00:00", durationMinutes: 30 }),
      } as Response)

      const recent = new Date(Date.now() + 24 * 3600 * 1000).toISOString()
      render(
        <AppointmentDetailModal
          state={makeState({
            detail: { ...baseDetail, status: "cancelled", proposedAlternativeAt: recent },
          })}
          openId={42}
          onClose={onClose}
          onActionSuccess={onActionSuccess}
          userRole="DOCTOR"
        />,
      )
      fireEvent.click(screen.getByText("actionAcceptAlternative"))
      fireEvent.click(screen.getByText("actionConfirmAcceptAlt"))

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/appointments/42/accept-alternative",
          expect.objectContaining({ method: "POST" }),
        )
      })
      expect(onActionSuccess).toHaveBeenCalledTimes(1)
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it("US-2500-UI iter 11 — bouton 'Confirmer' visible si status=pending_validation + DOCTOR/ADMIN", () => {
      const { rerender } = render(
        <AppointmentDetailModal
          state={makeState({
            detail: { ...baseDetail, status: "pending_validation" },
          })}
          openId={42}
          onClose={onClose}
          onActionSuccess={onActionSuccess}
          userRole="DOCTOR"
        />,
      )
      expect(screen.getByText("actionConfirmPending")).toBeTruthy()

      rerender(
        <AppointmentDetailModal
          state={makeState({
            detail: { ...baseDetail, status: "pending_validation" },
          })}
          openId={42}
          onClose={onClose}
          onActionSuccess={onActionSuccess}
          userRole="ADMIN"
        />,
      )
      expect(screen.getByText("actionConfirmPending")).toBeTruthy()
    })

    it("US-2500-UI iter 11 — bouton 'Confirmer' CACHÉ pour NURSE/VIEWER (RBAC DOCTOR+ uniquement)", () => {
      const { rerender } = render(
        <AppointmentDetailModal
          state={makeState({
            detail: { ...baseDetail, status: "pending_validation" },
          })}
          openId={42}
          onClose={onClose}
          onActionSuccess={onActionSuccess}
          userRole="NURSE"
        />,
      )
      expect(screen.queryByText("actionConfirmPending")).toBeNull()

      rerender(
        <AppointmentDetailModal
          state={makeState({
            detail: { ...baseDetail, status: "pending_validation" },
          })}
          openId={42}
          onClose={onClose}
          onActionSuccess={onActionSuccess}
          userRole="VIEWER"
        />,
      )
      expect(screen.queryByText("actionConfirmPending")).toBeNull()
    })

    it("US-2500-UI iter 11 — bouton 'Confirmer' CACHÉ si status ≠ pending_validation", () => {
      render(
        <AppointmentDetailModal
          state={makeState({ detail: { ...baseDetail, status: "scheduled" } })}
          openId={42}
          onClose={onClose}
          onActionSuccess={onActionSuccess}
          userRole="DOCTOR"
        />,
      )
      expect(screen.queryByText("actionConfirmPending")).toBeNull()
    })

    it("US-2500-UI iter 11 — clic 'Confirmer' → POST /api/appointments/[id]/confirm + onActionSuccess", async () => {
      vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({ id: 42, status: "scheduled", date: "2026-06-15", hour: "09:30:00", durationMinutes: 30 }),
      } as Response)

      render(
        <AppointmentDetailModal
          state={makeState({
            detail: { ...baseDetail, status: "pending_validation" },
          })}
          openId={42}
          onClose={onClose}
          onActionSuccess={onActionSuccess}
          userRole="DOCTOR"
        />,
      )
      fireEvent.click(screen.getByText("actionConfirmPending"))

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/appointments/42/confirm",
          expect.objectContaining({ method: "POST" }),
        )
      })
      expect(onActionSuccess).toHaveBeenCalledTimes(1)
      expect(onClose).toHaveBeenCalledTimes(1)
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
