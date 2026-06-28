/**
 * Test suite: garde de rôle de la page /import (server component).
 *
 * Comportement testé : `/import` est réservé aux rôles ≥ DOCTOR (DOCTOR + ADMIN
 * par hiérarchie, miroir de l'API `requireRole(req,"DOCTOR")` min-role). NURSE,
 * VIEWER, rôle inconnu et absence de header doivent être redirigés (fail-closed)
 * — sinon la page était atteignable par URL directe (la nav la masque
 * seulement). Bug RBAC détecté à l'audit d'accès par rôle.
 *
 * Le mock `redirect` n'interrompt pas l'exécution (le vrai `redirect()` de Next
 * lève `NEXT_REDIRECT`) ; on vérifie la **décision** du garde : `redirect("/")`
 * appelé pour les rôles refusés, jamais pour DOCTOR/ADMIN.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// vi.hoisted : remonté au-dessus des vi.mock (les factories y accèdent).
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

  it.each([
    ["NURSE", "NURSE"],
    ["VIEWER", "VIEWER"],
    ["un rôle inconnu", "SUPERUSER"],
    ["une chaîne vide", ""],
    ["aucun header", null],
  ])("redirige %s (fail-closed)", async (_label, value) => {
    h.role = value
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
