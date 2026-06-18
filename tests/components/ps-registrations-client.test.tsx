/**
 * @vitest-environment jsdom
 */

/**
 * Tests — PsRegistrationsClient (US-2613 PR6b-2, validation preuves PS).
 * Vérifie : liste en attente, validation (PATCH + CSRF + retrait de la ligne),
 * état vide.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

vi.mock("next-intl", async () => (await import("../helpers/nextIntlMock")).makeNextIntlMock())
vi.mock("@/components/diabeo/DiabeoButton", () => ({
  DiabeoButton: ({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) => (
    <button onClick={onClick} disabled={disabled}>{children}</button>
  ),
}))
vi.mock("@/components/diabeo/DiabeoEmptyState", () => ({
  DiabeoEmptyState: ({ title }: { title: string }) => <div data-testid="empty">{title}</div>,
}))

import { PsRegistrationsClient } from "@/components/diabeo/admin/PsRegistrationsClient"

const ROWS = [
  { id: 1, userId: 5, firstname: "Marie", lastname: "Curie", email: "m@x.fr", country: "FR", scheme: "RPPS", number: "10100000001", method: "manual" },
]

function mockFetch(items = ROWS) {
  return vi.fn((url: string, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "GET") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ items }) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) })
  })
}

beforeEach(() => vi.stubGlobal("fetch", mockFetch()))

describe("PsRegistrationsClient", () => {
  it("affiche les preuves en attente", async () => {
    render(<PsRegistrationsClient />)
    await waitFor(() => expect(screen.getByText("Marie Curie")).toBeTruthy())
    expect(screen.getByText("RPPS")).toBeTruthy()
  })

  it("valide une preuve (PATCH + CSRF) et retire la ligne", async () => {
    render(<PsRegistrationsClient />)
    await waitFor(() => expect(screen.getByText("Marie Curie")).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: "Valider" }))
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/admin/ps-registrations/1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ decision: "verified" }),
          headers: expect.objectContaining({ "X-Requested-With": "XMLHttpRequest" }),
        }),
      ),
    )
    await waitFor(() => expect(screen.queryByText("Marie Curie")).toBeNull())
  })

  it("liste vide → état vide", async () => {
    vi.stubGlobal("fetch", mockFetch([]))
    render(<PsRegistrationsClient />)
    await waitFor(() => expect(screen.getByTestId("empty")).toBeTruthy())
  })
})
