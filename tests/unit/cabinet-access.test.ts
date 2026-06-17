/**
 * Test suite : requireCabinetManagementAccess (US-2606 — garde des pages
 * « Gestion cabinet » per-id).
 *
 * Surface de durcissement URL : valide l'id de route, l'auth, et la capacité
 * Q2 sur LE cabinet ciblé (ADMIN bypass). Couvre l'anti-énumération (404
 * uniforme) et l'absence d'escalade horizontale (Q2 cabinet A ≠ cabinet B).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

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

const canManageOrg = vi.fn<(userId: number, serviceId: number) => Promise<boolean>>()
vi.mock("@/lib/capabilities", () => ({
  canManageOrg: (userId: number, serviceId: number) => canManageOrg(userId, serviceId),
}))

import { requireCabinetManagementAccess } from "@/lib/cabinet-access"

function stubHeaders(userId: string | null, role: string | null) {
  headersGet.mockImplementation((key: string) =>
    key === "x-user-id" ? userId : key === "x-user-role" ? role : null,
  )
}

beforeEach(() => {
  headersGet.mockReset()
  canManageOrg.mockReset()
})

describe("requireCabinetManagementAccess", () => {
  it("id de format invalide → notFound (avant toute lecture auth)", async () => {
    await expect(requireCabinetManagementAccess("1.5xyz")).rejects.toBeInstanceOf(NotFoundError)
    await expect(requireCabinetManagementAccess("0")).rejects.toBeInstanceOf(NotFoundError)
    await expect(requireCabinetManagementAccess("-3")).rejects.toBeInstanceOf(NotFoundError)
    expect(canManageOrg).not.toHaveBeenCalled()
  })

  it("auth manquante → redirect /login", async () => {
    stubHeaders(null, null)
    await expect(requireCabinetManagementAccess("9")).rejects.toMatchObject({ url: "/login" })
  })

  it("non-ADMIN sans Q2 sur ce cabinet → notFound (anti-énumération)", async () => {
    stubHeaders("5", "DOCTOR")
    canManageOrg.mockResolvedValue(false)
    await expect(requireCabinetManagementAccess("42")).rejects.toBeInstanceOf(NotFoundError)
    expect(canManageOrg).toHaveBeenCalledWith(5, 42)
  })

  it("non-ADMIN avec Q2 sur CE cabinet → accès accordé", async () => {
    stubHeaders("5", "DOCTOR")
    canManageOrg.mockResolvedValue(true)
    await expect(requireCabinetManagementAccess("9")).resolves.toEqual({
      cabinetId: 9,
      userId: 5,
      role: "DOCTOR",
    })
  })

  it("ADMIN → bypass (pas d'appel canManageOrg)", async () => {
    stubHeaders("1", "ADMIN")
    await expect(requireCabinetManagementAccess("9")).resolves.toMatchObject({
      cabinetId: 9,
      role: "ADMIN",
    })
    expect(canManageOrg).not.toHaveBeenCalled()
  })
})
