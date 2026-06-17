/**
 * @vitest-environment jsdom
 */

/**
 * Tests — CabinetInvoicesClient (US-2606, vues « Facturation » / « Paiements »).
 *
 * Vérifie : lecture liste via `/api/billing/invoices?cabinetId=…`, filtre
 * `status=paid` en mode paiements, état vide, chemin d'erreur + « réessayer ».
 * Aucune donnée de santé exposée (référence patient `#id` uniquement).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

vi.mock("next-intl", async () => (await import("../helpers/nextIntlMock")).makeNextIntlMock())
vi.mock("@/components/diabeo/DiabeoEmptyState", () => ({
  DiabeoEmptyState: ({ title, message }: { title: string; message: string }) => (
    <div data-testid="empty">{title} — {message}</div>
  ),
}))
vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

import { CabinetInvoicesClient } from "@/components/diabeo/cabinet/CabinetInvoicesClient"

const INVOICES = [
  { id: 11, number: "F-2026-001", patientId: 42, totalCents: 5000, currency: "EUR", status: "issued", issuedAt: "2026-06-01T10:00:00Z", paidAt: null, createdAt: "2026-05-30T08:00:00Z" },
  { id: 12, number: null, patientId: null, totalCents: 12000, currency: "EUR", status: "paid", issuedAt: "2026-06-02T10:00:00Z", paidAt: "2026-06-05T09:00:00Z", createdAt: "2026-06-01T08:00:00Z" },
]

function mockFetchOk(items = INVOICES) {
  return vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ items }) }))
}

beforeEach(() => vi.stubGlobal("fetch", mockFetchOk()))

describe("CabinetInvoicesClient", () => {
  it("mode billing : liste les factures du cabinet", async () => {
    render(<CabinetInvoicesClient cabinetId={9} mode="billing" />)
    await waitFor(() => expect(screen.getByText("F-2026-001")).toBeTruthy())
    // Facture sans numéro → repli sur #id ; patient null → tiret.
    expect(screen.getByText("#12")).toBeTruthy()
    expect(screen.getByText("#42")).toBeTruthy()
    // L'appel cible bien le cabinet, sans filtre de statut en mode billing.
    const url = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(url).toContain("cabinetId=9")
    expect(url).not.toContain("status=")
  })

  it("mode payments : filtre status=paid", async () => {
    render(<CabinetInvoicesClient cabinetId={9} mode="payments" />)
    await waitFor(() =>
      expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0),
    )
    const url = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(url).toContain("cabinetId=9")
    expect(url).toContain("status=paid")
  })

  it("liste vide → état vide", async () => {
    vi.stubGlobal("fetch", mockFetchOk([]))
    render(<CabinetInvoicesClient cabinetId={9} mode="billing" />)
    await waitFor(() => expect(screen.getByTestId("empty")).toBeTruthy())
  })

  it("erreur → alerte + « réessayer » refait l'appel", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 403, json: () => Promise.resolve({ error: "forbidden" }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ items: INVOICES }) })
    vi.stubGlobal("fetch", fetchMock)
    render(<CabinetInvoicesClient cabinetId={9} mode="billing" />)
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }))
    await waitFor(() => expect(screen.getByText("F-2026-001")).toBeTruthy())
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
