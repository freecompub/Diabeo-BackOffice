/**
 * @vitest-environment jsdom
 */

/**
 * Tests — TenantDetailClient (US-2613 PR6b-1, détail organisation).
 * Vérifie : chargement, enregistrement (PATCH + CSRF), rattachement (POST + CSRF)
 * et — régression review M2 — que le message de succès du rattachement reste
 * affiché (form non démonté, refresh silencieux sans repasser en « loading »).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

vi.mock("next-intl", async () => (await import("../helpers/nextIntlMock")).makeNextIntlMock())
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}))
vi.mock("@/components/diabeo/DiabeoButton", () => ({
  DiabeoButton: ({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) => (
    <button onClick={onClick} disabled={disabled}>{children}</button>
  ),
}))

import { TenantDetailClient } from "@/components/diabeo/admin/TenantDetailClient"

const TENANT = { id: 9, name: "Cabinet Nord", country: "FR", serviceCount: 2 }

function mockFetch() {
  return vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET"
    if (url.includes("/api/admin/healthcare-services")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [{ id: 3, name: "Établissement A" }] }) })
    }
    if (url === "/api/admin/tenants/9" && method === "GET") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(TENANT) })
    }
    // PATCH tenant / POST services
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) })
  })
}

beforeEach(() => vi.stubGlobal("fetch", mockFetch()))

describe("TenantDetailClient", () => {
  it("charge et affiche le tenant", async () => {
    render(<TenantDetailClient tenantId={9} />)
    await waitFor(() => expect(screen.getByRole("heading", { name: "Cabinet Nord" })).toBeTruthy())
  })

  it("enregistre (PATCH + header CSRF)", async () => {
    render(<TenantDetailClient tenantId={9} />)
    await waitFor(() => expect(screen.getByRole("heading", { name: "Cabinet Nord" })).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }))
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/admin/tenants/9",
        expect.objectContaining({
          method: "PATCH",
          headers: expect.objectContaining({ "X-Requested-With": "XMLHttpRequest" }),
        }),
      ),
    )
  })

  it("rattache un établissement (POST + CSRF) et conserve le message de succès", async () => {
    render(<TenantDetailClient tenantId={9} />)
    await waitFor(() => expect(screen.getByRole("option", { name: "Établissement A" })).toBeTruthy())
    fireEvent.change(screen.getByLabelText(/Rattacher un établissement/), { target: { value: "3" } })
    fireEvent.click(screen.getByRole("button", { name: "Rattacher" }))
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/admin/tenants/9/services",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ "X-Requested-With": "XMLHttpRequest" }),
        }),
      ),
    )
    // Régression M2 : le form reste monté (refresh silencieux) et le message persiste.
    await waitFor(() => expect(screen.getByText("Établissement rattaché.")).toBeTruthy())
    expect(screen.getByRole("heading", { name: "Cabinet Nord" })).toBeTruthy()
  })
})
