/**
 * @vitest-environment jsdom
 */

/**
 * Test suite : CabinetManagementLanding (US-2606 — atterrissage cabinet-agnostique
 * du bloc « Gestion »).
 *
 * Couvre la résolution du périmètre Q2 : ADMIN → espace plateforme ; 0 cabinet →
 * notFound ; 1 cabinet → redirection directe (avec mapping section→segment, ex.
 * `team → members`) ; N cabinets → sélecteur (rendu : un lien par cabinet vers
 * la section, badge admin principal le cas échéant).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"

const headersGet = vi.fn<(key: string) => string | null>()
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({ get: headersGet })),
}))

class NotFoundError extends Error {}
class RedirectError extends Error {
  constructor(public url: string) {
    super(`redirect:${url}`)
  }
}
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new NotFoundError("notFound")
  }),
  redirect: vi.fn((url: string) => {
    throw new RedirectError(url)
  }),
}))

const getManagementScopes = vi.fn()
vi.mock("@/lib/capabilities", () => ({
  getManagementScopes: (userId: number) => getManagementScopes(userId),
}))

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async (ns?: string) => (key: string) => (ns ? `${ns}.${key}` : key)),
}))

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

import { CabinetManagementLanding } from "@/components/diabeo/cabinet/CabinetManagementLanding"

beforeEach(() => {
  headersGet.mockReset()
  getManagementScopes.mockReset()
  headersGet.mockImplementation((key: string) =>
    key === "x-user-id" ? "5" : key === "x-user-role" ? "DOCTOR" : null,
  )
})

describe("CabinetManagementLanding", () => {
  it("ADMIN → redirige vers l'espace plateforme /admin/cabinets", async () => {
    headersGet.mockImplementation((key: string) =>
      key === "x-user-id" ? "1" : key === "x-user-role" ? "ADMIN" : null,
    )
    await expect(CabinetManagementLanding({ section: "team" })).rejects.toMatchObject({
      url: "/admin/cabinets",
    })
    expect(getManagementScopes).not.toHaveBeenCalled()
  })

  it("0 cabinet managé → notFound", async () => {
    getManagementScopes.mockResolvedValue([])
    await expect(CabinetManagementLanding({ section: "billing" })).rejects.toBeInstanceOf(NotFoundError)
  })

  it("1 cabinet → redirection directe, section team → segment members", async () => {
    getManagementScopes.mockResolvedValue([{ serviceId: 9, serviceName: "Nord", isPrincipalAdmin: true }])
    await expect(CabinetManagementLanding({ section: "team" })).rejects.toMatchObject({
      url: "/cabinet/9/members",
    })
  })

  it("1 cabinet → segment billing conservé", async () => {
    getManagementScopes.mockResolvedValue([{ serviceId: 7, serviceName: "Sud", isPrincipalAdmin: false }])
    await expect(CabinetManagementLanding({ section: "billing" })).rejects.toMatchObject({
      url: "/cabinet/7/billing",
    })
  })

  it("N cabinets → rend le sélecteur (un lien par cabinet vers la section)", async () => {
    getManagementScopes.mockResolvedValue([
      { serviceId: 9, serviceName: "Nord", isPrincipalAdmin: true },
      { serviceId: 7, serviceName: "Sud", isPrincipalAdmin: false },
    ])
    const el = await CabinetManagementLanding({ section: "settings" })
    render(el)
    // Un lien par cabinet, ciblant le segment de la section (settings).
    const nord = screen.getByText("Nord").closest("a")
    const sud = screen.getByText("Sud").closest("a")
    expect(nord?.getAttribute("href")).toBe("/cabinet/9/settings")
    expect(sud?.getAttribute("href")).toBe("/cabinet/7/settings")
    // Badge « admin principal » uniquement pour le cabinet où isPrincipalAdmin.
    const badges = screen.getAllByText("cabinetMgmt.principalBadge")
    expect(badges).toHaveLength(1)
  })
})
