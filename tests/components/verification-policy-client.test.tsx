/**
 * @vitest-environment jsdom
 */

/**
 * Tests — VerificationPolicyClient (US-2613 PR6b-2, politique de vérification).
 * Vérifie : liste, état vide, pose d'une politique (POST + header CSRF).
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
vi.mock("@/components/diabeo/DiabeoEmptyState", () => ({
  DiabeoEmptyState: ({ title }: { title: string }) => <div data-testid="empty">{title}</div>,
}))

import { VerificationPolicyClient } from "@/components/diabeo/admin/VerificationPolicyClient"

function mockFetch(items: unknown[] = []) {
  return vi.fn((url: string, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "GET") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ items }) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 1 }) })
  })
}

beforeEach(() => vi.stubGlobal("fetch", mockFetch()))

describe("VerificationPolicyClient", () => {
  it("liste vide → état vide", async () => {
    render(<VerificationPolicyClient />)
    await waitFor(() => expect(screen.getByTestId("empty")).toBeTruthy())
  })

  it("pose une politique tenant/required (POST + CSRF)", async () => {
    render(<VerificationPolicyClient />)
    await waitFor(() => expect(screen.getByTestId("empty")).toBeTruthy())
    fireEvent.change(screen.getByLabelText(/Identifiant de l'organisation/), { target: { value: "5" } })
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la politique" }))
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/admin/verification-policies",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ "X-Requested-With": "XMLHttpRequest" }),
        }),
      ),
    )
    const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find((c) => (c[1]?.method) === "POST")
    expect(JSON.parse(call![1].body as string)).toMatchObject({ mode: "required", tenantId: 5 })
  })
})
