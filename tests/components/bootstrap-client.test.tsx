/**
 * @vitest-environment jsdom
 */

/**
 * Tests — BootstrapClient (US-2613 PR6b-1, bootstrap du premier org-admin).
 * Vérifie : chargement des établissements + envoi du bootstrap (POST + CSRF).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

vi.mock("next-intl", async () => (await import("../helpers/nextIntlMock")).makeNextIntlMock())
vi.mock("@/components/diabeo/DiabeoButton", () => ({
  DiabeoButton: ({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) => (
    <button onClick={onClick} disabled={disabled}>{children}</button>
  ),
}))

import { BootstrapClient } from "@/components/diabeo/admin/BootstrapClient"

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (typeof url === "string" && url.includes("/api/admin/healthcare-services")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [{ id: 3, name: "Cabinet Nord" }] }) })
    }
    // POST bootstrap
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ userId: 50, invitedNewUser: true }) })
  }))
})

describe("BootstrapClient", () => {
  it("charge les établissements puis envoie le bootstrap (POST + CSRF)", async () => {
    render(<BootstrapClient />)
    // L'option établissement apparaît après le chargement.
    await waitFor(() => expect(screen.getByRole("option", { name: "Cabinet Nord" })).toBeTruthy())

    fireEvent.change(screen.getByLabelText(/Établissement/), { target: { value: "3" } })
    fireEvent.change(screen.getByLabelText(/E-mail/), { target: { value: "admin@x.fr" } })
    fireEvent.click(screen.getByRole("button", { name: "Inviter l'administrateur" }))

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/admin/platform/bootstrap",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ "X-Requested-With": "XMLHttpRequest" }),
        }),
      ),
    )
  })

  it("bouton désactivé tant que établissement/e-mail invalides", async () => {
    render(<BootstrapClient />)
    await waitFor(() => expect(screen.getByRole("option", { name: "Cabinet Nord" })).toBeTruthy())
    const submit = screen.getByRole("button", { name: "Inviter l'administrateur" }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
  })
})
