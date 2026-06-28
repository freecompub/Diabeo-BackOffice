/**
 * Test suite: garde de rôle de la page /import (server component).
 *
 * Comportement testé : `/import` est réservé au médecin (et ADMIN par
 * hiérarchie, mirroir de l'API `requireRole(req,"DOCTOR")` min-role). Un NURSE
 * (ou une absence de header rôle) doit être redirigé — sinon il atteignait la
 * page par URL directe (la nav la masque seulement) et tombait sur une UI en
 * cul-de-sac (403 à l'action). Bug RBAC détecté à l'audit d'accès par rôle.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// vi.hoisted : ces valeurs sont remontées au-dessus des vi.mock (sinon les
// factories ne peuvent pas y accéder — hoisting vitest).
const h = vi.hoisted(() => ({
  role: "NURSE" as string | null,
  redirectMock: vi.fn(),
}))
vi.mock("next/headers", () => ({ headers: async () => ({ get: () => h.role }) }))
vi.mock("next/navigation", () => ({ redirect: h.redirectMock }))
// Stub le client lourd : on ne teste que la décision du garde.
vi.mock("@/app/(dashboard)/import/ImportClient", () => ({ ImportClient: () => null }))

import ImportPage from "@/app/(dashboard)/import/page"

describe("ImportPage — garde de rôle serveur", () => {
  beforeEach(() => h.redirectMock.mockClear())

  it("redirige un NURSE (feature DOCTOR-only)", async () => {
    h.role = "NURSE"
    await ImportPage()
    expect(h.redirectMock).toHaveBeenCalledWith("/")
  })

  it("redirige si aucun header de rôle", async () => {
    h.role = null
    await ImportPage()
    expect(h.redirectMock).toHaveBeenCalledWith("/")
  })

  it("laisse passer un DOCTOR (pas de redirect)", async () => {
    h.role = "DOCTOR"
    await ImportPage()
    expect(h.redirectMock).not.toHaveBeenCalled()
  })

  it("laisse passer un ADMIN (mirroir min-role de l'API)", async () => {
    h.role = "ADMIN"
    await ImportPage()
    expect(h.redirectMock).not.toHaveBeenCalled()
  })
})
