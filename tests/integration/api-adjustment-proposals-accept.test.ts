/**
 * Régression A4 — mapping HTTP de PATCH /api/adjustment-proposals/[id]/accept.
 *
 * Un audit QA avait signalé « valeur hors bornes → 500 ». En réalité la route
 * mappe déjà `valueOutOfBounds` → **400** (et la transaction du service annule
 * l'update de statut). De plus, l'UI envoie toujours `applyImmediately: false`,
 * donc le chemin de validation des bornes n'est atteignable que via API directe
 * ou un futur toggle. Ce test verrouille le contrat HTTP pour ce cas-là.
 *
 * Comportement testé :
 * - service lève `valueOutOfBounds` → 400 (pas 500) — sécurité : pas d'application
 *   d'un réglage insuline hors bornes cliniques.
 * - proposition absente / déjà traitée → 404.
 * - accès patient refusé → 403.
 * - succès → 200.
 */

import { describe, expect, it, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(() => ({ id: 7, role: "DOCTOR" })),
  AuthError: class AuthError extends Error {
    status: number
    constructor(message: string, status = 401) {
      super(message)
      this.status = status
    }
  },
}))

const canAccessPatient = vi.fn().mockResolvedValue(true)
vi.mock("@/lib/access-control", () => ({
  canAccessPatient: (...args: unknown[]) => canAccessPatient(...args),
}))

const findUnique = vi.fn()
vi.mock("@/lib/db/client", () => ({
  prisma: { adjustmentProposal: { findUnique: (...a: unknown[]) => findUnique(...a) } },
}))

const accept = vi.fn()
const notifyPatient = vi.fn().mockResolvedValue({ notified: true })
vi.mock("@/lib/services/adjustment.service", () => ({
  adjustmentService: {
    accept: (...a: unknown[]) => accept(...a),
    notifyPatient: (...a: unknown[]) => notifyPatient(...a),
  },
}))

vi.mock("@/lib/services/audit.service", () => ({
  extractRequestContext: () => ({ ipAddress: "1.2.3.4", userAgent: "vitest", requestId: "r" }),
}))
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

const { PATCH } = await import("@/app/api/adjustment-proposals/[id]/accept/route")

function acceptReq(body: unknown = { applyImmediately: true }): NextRequest {
  return new NextRequest(new URL("http://localhost/api/adjustment-proposals/p1/accept"), {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-user-id": "7", "x-user-role": "DOCTOR" },
    body: JSON.stringify(body),
  })
}

const params = { params: Promise.resolve({ id: "p1" }) }

describe("PATCH /api/adjustment-proposals/[id]/accept — mapping erreurs (A4)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    canAccessPatient.mockResolvedValue(true)
    notifyPatient.mockResolvedValue({ notified: true })
    findUnique.mockResolvedValue({ patientId: 42, status: "pending" })
  })

  it("valeur hors bornes → 400 valueOutOfBounds (jamais 500)", async () => {
    accept.mockRejectedValue(new Error("valueOutOfBounds"))
    const res = await PATCH(acceptReq(), params)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "valueOutOfBounds" })
  })

  it("proposition absente ou déjà traitée → 404", async () => {
    findUnique.mockResolvedValue(null)
    const res = await PATCH(acceptReq(), params)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: "proposalNotFound" })
  })

  it("patient hors portefeuille → 403", async () => {
    canAccessPatient.mockResolvedValue(false)
    const res = await PATCH(acceptReq(), params)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: "forbidden" })
  })

  it("acceptation valide → 200", async () => {
    accept.mockResolvedValue({ accepted: true, applied: true, patientId: 42 })
    const res = await PATCH(acceptReq(), params)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ accepted: true, notified: true })
  })
})
