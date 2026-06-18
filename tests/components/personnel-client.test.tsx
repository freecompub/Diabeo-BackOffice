/**
 * @vitest-environment jsdom
 */

/**
 * Tests — PersonnelClient (US-2613 PR6b-2, personnel cross-tenant).
 * Vérifie : recherche → résultats, sélection → capacités, révocation (POST + CSRF).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

vi.mock("next-intl", async () => (await import("../helpers/nextIntlMock")).makeNextIntlMock())
vi.mock("@/components/diabeo/DiabeoButton", () => ({
  DiabeoButton: ({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) => (
    <button onClick={onClick} disabled={disabled}>{children}</button>
  ),
}))
vi.mock("@/components/ui/badge", () => ({ Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }))

import { PersonnelClient } from "@/components/diabeo/admin/PersonnelClient"

const PERSONNEL = {
  user: { id: 5, firstname: "Sophie", lastname: "Martin", email: "s@x.fr", role: "DOCTOR", status: "active" },
  memberships: [
    { serviceId: 9, serviceName: "Cabinet Nord", tenantId: 3, clinicalRole: "DOCTOR", canManage: true, isPrincipalAdmin: true },
  ],
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (url.includes("/api/admin/users")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [{ id: 5, firstname: "Sophie", lastname: "Martin", email: "s@x.fr", role: "DOCTOR" }] }) })
    }
    if (url.includes("/revoke")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) })
    }
    // GET personnel/5
    return Promise.resolve({ ok: true, json: () => Promise.resolve(PERSONNEL) })
  }))
})

describe("PersonnelClient", () => {
  it("recherche → sélection → capacités → révocation (POST + CSRF)", async () => {
    render(<PersonnelClient />)
    fireEvent.change(screen.getByLabelText(/Rechercher un compte/), { target: { value: "Martin" } })
    fireEvent.click(screen.getByRole("button", { name: "Rechercher" }))

    // Résultat de recherche.
    await waitFor(() => expect(screen.getByText("Sophie Martin")).toBeTruthy())
    fireEvent.click(screen.getByText("Sophie Martin"))

    // Capacités chargées.
    await waitFor(() => expect(screen.getByText("Cabinet Nord")).toBeTruthy())

    // Révocation.
    fireEvent.click(screen.getByRole("button", { name: "Révoquer" }))
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/admin/platform/personnel/5/revoke",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ serviceId: 9 }),
          headers: expect.objectContaining({ "X-Requested-With": "XMLHttpRequest" }),
        }),
      ),
    )
  })
})
