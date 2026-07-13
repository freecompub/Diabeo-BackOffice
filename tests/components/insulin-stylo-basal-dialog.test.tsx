/**
 * @vitest-environment jsdom
 */

/**
 * Tests — InsulinStyloBasalDialog : accusé jour-de-maladie / acidocétose (DKA) sur baisse basale STYLO.
 *
 * Risque clinique couvert (US-2663 S4, décision D3) : réduire une insuline lente un jour de maladie
 * expose à l'acidocétose. La case d'accusé DOIT :
 *  - apparaître UNIQUEMENT quand le patient BAISSE une dose (pas sur une hausse) ;
 *  - BLOQUER la soumission tant qu'elle n'est pas cochée ;
 *  - une fois cochée, transmettre `sickDayAcknowledged: true` sur la route own-id patient.
 * Et le mapping d'un rejet serveur (garde patient) doit afficher un message dédié (jamais un 500 nu).
 *
 * Le `Dialog` de `components/ui` est mocké (rendu inline quand ouvert) pour éviter le portail Base UI
 * en jsdom — le comportement testé est la LOGIQUE du dialog, pas le composant de surface shadcn.
 */

import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"
import type { ReactNode } from "react"

vi.mock("next-intl", async () => (await import("../helpers/nextIntlMock")).makeNextIntlMock())
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}))

import { InsulinStyloBasalDialog } from "@/components/diabeo/patient/InsulinStyloBasalDialog"
import { PatientRecordProvider, type RecordMutator } from "@/components/diabeo/patient/PatientRecordContext"

const BOUNDS = { min: 1, max: 80 }

/** Fabrique une réponse minimale compatible `Response` pour le transport `mutate`. */
function jsonResponse(status: number, body: unknown): Response {
  return { status, json: async () => body } as unknown as Response
}

function renderDialog(mutate: ReturnType<typeof vi.fn>, initial: { kind: "daily"; value: number }[]) {
  return render(
    <PatientRecordProvider fetchAnalytics={vi.fn()} mutate={mutate as unknown as RecordMutator}>
      <InsulinStyloBasalDialog
        paramLabel="Insuline lente"
        unit="U"
        initialSlots={initial}
        bounds={BOUNDS}
        audience="patient"
      />
    </PatientRecordProvider>,
  )
}

const openDialog = () => fireEvent.click(screen.getByRole("button", { name: /Proposer un ajustement/ }))
const doseInput = () => screen.getByRole("textbox")
const submitButton = () => screen.getByRole("button", { name: "Envoyer la proposition" })

describe("InsulinStyloBasalDialog — accusé DKA sur baisse stylo", () => {
  it("baisse de dose : la case DKA apparaît et bloque la soumission tant qu'elle n'est pas cochée", async () => {
    const mutate = vi.fn().mockResolvedValue(jsonResponse(201, { outcome: "proposal", proposalId: 1 }))
    renderDialog(mutate, [{ kind: "daily", value: 20 }])
    openDialog()

    // Pas de baisse encore → pas de case DKA.
    expect(screen.queryByRole("checkbox")).toBeNull()

    // Baisse 20 → 18.
    fireEvent.change(doseInput(), { target: { value: "18" } })
    const dka = screen.getByRole("checkbox")
    expect(dka).toBeTruthy()

    // Soumission bloquée tant que non cochée (aria-disabled + handler no-op).
    expect(submitButton().getAttribute("aria-disabled")).toBe("true")
    await act(async () => {
      fireEvent.click(submitButton())
    })
    expect(mutate).not.toHaveBeenCalled()

    // Coche l'accusé → soumission possible.
    fireEvent.click(dka)
    expect(submitButton().getAttribute("aria-disabled")).toBe("false")
    await act(async () => {
      fireEvent.click(submitButton())
    })

    expect(mutate).toHaveBeenCalledTimes(1)
    const [endpoint, body, init] = mutate.mock.calls[0]!
    expect(endpoint).toBe("/api/patient/insulin-slot-set")
    expect(init).toMatchObject({ method: "PUT" })
    expect(body).toEqual({
      parameterType: "basalRate",
      slots: [{ kind: "daily", value: 18 }],
      sickDayAcknowledged: true,
    })
    // Message de succès (proposition envoyée pour revue).
    expect(screen.getByText("Proposition envoyée pour revue médicale.")).toBeTruthy()
  })

  it("hausse de dose : aucune case DKA, soumission directe sans accusé", async () => {
    const mutate = vi.fn().mockResolvedValue(jsonResponse(201, { outcome: "proposal", proposalId: 2 }))
    renderDialog(mutate, [{ kind: "daily", value: 20 }])
    openDialog()

    fireEvent.change(doseInput(), { target: { value: "22" } })
    expect(screen.queryByRole("checkbox")).toBeNull()
    expect(submitButton().getAttribute("aria-disabled")).toBe("false")

    await act(async () => {
      fireEvent.click(submitButton())
    })
    const [, body] = mutate.mock.calls[0]!
    expect(body).not.toHaveProperty("sickDayAcknowledged")
    expect(body).toMatchObject({ parameterType: "basalRate", slots: [{ kind: "daily", value: 22 }] })
  })

  it("rejet serveur (garde patient) : message dédié, jamais générique", async () => {
    const mutate = vi.fn().mockResolvedValue(jsonResponse(422, { error: "patientDeltaTooLarge" }))
    renderDialog(mutate, [{ kind: "daily", value: 20 }])
    openDialog()

    fireEvent.change(doseInput(), { target: { value: "18" } })
    fireEvent.click(screen.getByRole("checkbox"))
    await act(async () => {
      fireEvent.click(submitButton())
    })

    expect(
      screen.getByText("Variation trop importante pour une proposition. Réduisez l'écart ou contactez votre soignant."),
    ).toBeTruthy()
  })
})
