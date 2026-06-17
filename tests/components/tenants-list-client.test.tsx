/**
 * @vitest-environment jsdom
 */

/**
 * Tests — TenantsListClient (US-2613 PR6b-1, liste/création des organisations).
 * Vérifie : liste depuis l'API, état vide, création (POST + header CSRF).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

vi.mock("next-intl", async () => (await import("../helpers/nextIntlMock")).makeNextIntlMock())
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}))
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

import { TenantsListClient } from "@/components/diabeo/admin/TenantsListClient"

const TENANTS = [
  { id: 1, name: "Cabinet Nord", country: "FR", serviceCount: 2 },
  { id: 2, name: "Hôpital Sud", country: "DZ", serviceCount: 5 },
]

function mockFetchOk(items = TENANTS) {
  return vi.fn((url: string, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "GET") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ items }) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 9 }) })
  })
}

beforeEach(() => vi.stubGlobal("fetch", mockFetchOk()))

describe("TenantsListClient", () => {
  it("affiche les organisations", async () => {
    render(<TenantsListClient />)
    await waitFor(() => expect(screen.getByText("Cabinet Nord")).toBeTruthy())
    expect(screen.getByText("Hôpital Sud")).toBeTruthy()
  })

  it("liste vide → état vide", async () => {
    vi.stubGlobal("fetch", mockFetchOk([]))
    render(<TenantsListClient />)
    await waitFor(() => expect(screen.getByTestId("empty")).toBeTruthy())
  })

  it("crée une organisation (POST + header CSRF)", async () => {
    render(<TenantsListClient />)
    await waitFor(() => expect(screen.getByText("Cabinet Nord")).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: "Nouvelle organisation" }))
    fireEvent.change(screen.getByLabelText(/Nom/), { target: { value: "Clinique Est" } })
    fireEvent.click(screen.getByRole("button", { name: "Créer" }))
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/admin/tenants",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ "X-Requested-With": "XMLHttpRequest" }),
        }),
      ),
    )
  })
})
