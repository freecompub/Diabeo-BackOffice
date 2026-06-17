/**
 * @vitest-environment jsdom
 */

/**
 * Tests — MembersManagementClient (US-2610 PR4b, écran gestion des membres).
 *
 * Vérifie le branchement client : liste depuis l'API, bascule de la capacité de
 * gestion (PATCH), retrait d'un membre (DELETE), invitation (POST). Les gardes
 * Q2 + règles sont côté service/route (testées ailleurs).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

vi.mock("next-intl", async () => (await import("../helpers/nextIntlMock")).makeNextIntlMock())
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}))
vi.mock("@/components/diabeo/DiabeoButton", () => ({
  DiabeoButton: ({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) => (
    <button onClick={onClick} disabled={disabled}>{children}</button>
  ),
}))
vi.mock("@/components/diabeo/DiabeoEmptyState", () => ({
  DiabeoEmptyState: ({ title, message }: { title: string; message: string }) => (
    <div data-testid="empty">{title} — {message}</div>
  ),
}))
vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

import { MembersManagementClient } from "@/components/diabeo/cabinet/MembersManagementClient"

const MEMBERS = [
  { userId: 2, firstname: "Sophie", lastname: "Martin", email: "s@x.fr", clinicalRole: "DOCTOR", canManage: true, isPrincipalAdmin: true },
  { userId: 3, firstname: "Marie", lastname: "Dupont", email: "m@x.fr", clinicalRole: "NURSE", canManage: false, isPrincipalAdmin: false },
]

function mockFetchOk(members = MEMBERS) {
  return vi.fn((url: string, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "GET") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ members }) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) })
  })
}

beforeEach(() => vi.stubGlobal("fetch", mockFetchOk()))

describe("MembersManagementClient", () => {
  it("affiche les membres (nom + rôle clinique)", async () => {
    render(<MembersManagementClient cabinetId={9} />)
    await waitFor(() => expect(screen.getByText("Sophie Martin")).toBeTruthy())
    expect(screen.getByText("Marie Dupont")).toBeTruthy()
    expect(screen.getByText("Infirmier")).toBeTruthy() // NURSE → libellé
  })

  it("bascule la capacité de gestion (PATCH canManage)", async () => {
    render(<MembersManagementClient cabinetId={9} />)
    await waitFor(() => expect(screen.getByText("Marie Dupont")).toBeTruthy())
    // Marie (NURSE, canManage=false) → bouton « Octroyer la gestion ».
    fireEvent.click(screen.getByRole("button", { name: "Octroyer la gestion" }))
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/cabinet/9/members/3",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ canManage: true }),
          // CSRF — le middleware exige ce header sur les mutations (régression 403 sinon).
          headers: expect.objectContaining({ "X-Requested-With": "XMLHttpRequest" }),
        }),
      ),
    )
  })

  it("erreur de mutation → message d'alerte (pas d'échec silencieux)", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) =>
      (init?.method ?? "GET") === "GET"
        ? Promise.resolve({ ok: true, json: () => Promise.resolve({ members: MEMBERS }) })
        : Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({ error: "forbidden" }) }),
    ))
    render(<MembersManagementClient cabinetId={9} />)
    await waitFor(() => expect(screen.getByText("Marie Dupont")).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: "Octroyer la gestion" }))
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy())
  })

  it("retire un membre (dialog → DELETE)", async () => {
    render(<MembersManagementClient cabinetId={9} />)
    await waitFor(() => expect(screen.getByText("Marie Dupont")).toBeTruthy())
    // Ouvre le dialog de retrait pour Marie (2e bouton « Retirer »).
    fireEvent.click(screen.getAllByRole("button", { name: "Retirer" })[1])
    // Confirme.
    fireEvent.click(screen.getByRole("button", { name: "Retirer le membre" }))
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/cabinet/9/members/3",
        expect.objectContaining({ method: "DELETE" }),
      ),
    )
  })

  it("invite un membre (POST)", async () => {
    render(<MembersManagementClient cabinetId={9} />)
    await waitFor(() => expect(screen.getByText("Sophie Martin")).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: "Inviter un membre" }))
    fireEvent.change(screen.getByLabelText(/E-mail/), { target: { value: "new@x.fr" } })
    fireEvent.click(screen.getByRole("button", { name: "Envoyer l'invitation" }))
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/cabinet/9/members",
        expect.objectContaining({ method: "POST" }),
      ),
    )
  })

  it("liste vide → état vide", async () => {
    vi.stubGlobal("fetch", mockFetchOk([]))
    render(<MembersManagementClient cabinetId={9} />)
    await waitFor(() => expect(screen.getByTestId("empty")).toBeTruthy())
  })
})
