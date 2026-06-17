/**
 * Tests — POST /api/auth/refresh (US-2619/F7 + US-2148).
 *
 * Le refresh (Node) est le checkpoint de re-validation DB que le middleware Edge
 * ne peut pas faire : statut compte + version d'authentification (`av`). Vérifie :
 *  - session révoquée (Redis) → 401 ;
 *  - compte suspendu après émission → 401 accountSuspended ;
 *  - `av` périmé (droits changés) → 401 authVersionStale ;
 *  - cas nominal → 200 + nouveau token signé avec l'`av` à jour.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const verifyJwtAllowExpired = vi.fn()
const getSession = vi.fn()
const signJwt = vi.fn()
vi.mock("@/lib/auth", () => ({
  extractBearerToken: (req: Request) => req.headers.get("authorization")?.replace("Bearer ", "") ?? null,
  verifyJwtAllowExpired: (...a: unknown[]) => verifyJwtAllowExpired(...a),
  getSession: (...a: unknown[]) => getSession(...a),
  signJwt: (...a: unknown[]) => signJwt(...a),
}))

const isSessionRevoked = vi.fn()
vi.mock("@/lib/auth/revocation", () => ({ isSessionRevoked: (...a: unknown[]) => isSessionRevoked(...a) }))
vi.mock("@/lib/auth/session", () => ({ touchSession: vi.fn() }))

const findUnique = vi.fn()
vi.mock("@/lib/db/client", () => ({ prisma: { user: { findUnique: (...a: unknown[]) => findUnique(...a) } } }))
vi.mock("@/lib/services/audit.service", () => ({
  auditService: { log: vi.fn().mockResolvedValue(undefined) },
  extractRequestContext: () => ({ ipAddress: "1.2.3.4", userAgent: "vitest", requestId: "r" }),
}))

const { POST } = await import("@/app/api/auth/refresh/route")

const req = () =>
  new NextRequest(new URL("http://localhost/api/auth/refresh"), {
    method: "POST",
    headers: { authorization: "Bearer tok", "content-type": "application/json" },
  })

beforeEach(() => {
  vi.clearAllMocks()
  verifyJwtAllowExpired.mockResolvedValue({ sub: 42, role: "DOCTOR", platform: "hc", sid: "sid1", av: 3, exp: 9999999999 })
  isSessionRevoked.mockResolvedValue(false)
  getSession.mockResolvedValue({ id: "sid1", expires: new Date("2099-01-01") })
  findUnique.mockResolvedValue({ id: 42, role: "DOCTOR", status: "active", authVersion: 3 })
  signJwt.mockResolvedValue("new-token")
})

describe("POST /api/auth/refresh", () => {
  it("cas nominal → 200 + token réémis avec av à jour", async () => {
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ token: "new-token" })
    expect(signJwt).toHaveBeenCalledWith(expect.objectContaining({ av: 3, sid: "sid1" }))
  })

  it("session révoquée → 401 sessionRevoked", async () => {
    isSessionRevoked.mockResolvedValue(true)
    const res = await POST(req())
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: "sessionRevoked" })
  })

  it("compte suspendu après émission → 401 accountSuspended", async () => {
    findUnique.mockResolvedValue({ id: 42, role: "DOCTOR", status: "suspended", authVersion: 3 })
    const res = await POST(req())
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: "accountSuspended" })
    expect(signJwt).not.toHaveBeenCalled()
  })

  it("av périmé (droits changés) → 401 authVersionStale", async () => {
    findUnique.mockResolvedValue({ id: 42, role: "NURSE", status: "active", authVersion: 4 }) // bumpé à 4
    const res = await POST(req())
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: "authVersionStale" })
    expect(signJwt).not.toHaveBeenCalled()
  })
})
