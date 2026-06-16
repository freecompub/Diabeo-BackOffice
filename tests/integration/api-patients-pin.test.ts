/**
 * @description US-2603 — routes du switcher de contexte patient.
 * `POST/DELETE /api/patients/[id]/pin` (RBAC, 404, accès, consentement, cap) et
 * `GET /api/patients/recent` (RBAC). Le scope dur de la liste est testé au
 * niveau service (recent-patients.service.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const canAccessMock = vi.fn()
vi.mock("@/lib/access-control", () => ({ canAccessPatient: canAccessMock }))

const consentMock = vi.fn()
vi.mock("@/lib/consent", () => ({ patientShareConsent: consentMock }))

const pinMock = vi.fn()
const unpinMock = vi.fn()
const listMock = vi.fn()
vi.mock("@/lib/services/recent-patients.service", () => ({
  recentPatientsService: { pin: pinMock, unpin: unpinMock, listRecentAndPinned: listMock },
}))

const rateLimitMock = vi.fn()
vi.mock("@/lib/auth/api-rate-limit", () => ({
  checkApiRateLimit: rateLimitMock,
  RATE_LIMITS: { patientDataRead: {}, patientDataReadIp: {} },
}))

const findFirstMock = vi.fn()
vi.mock("@/lib/db/client", () => ({ prisma: { patient: { findFirst: findFirstMock } } }))

const accessDeniedMock = vi.fn()
vi.mock("@/lib/services/audit.service", () => ({
  auditService: { accessDenied: accessDeniedMock },
  extractRequestContext: () => ({ ipAddress: "127.0.0.1", userAgent: "test", requestId: "r1" }),
}))

const { POST, DELETE } = await import("@/app/api/patients/[id]/pin/route")
const { GET: GET_RECENT } = await import("@/app/api/patients/recent/route")

function req(role: string, method = "POST", id = "42"): NextRequest {
  const headers = new Headers()
  headers.set("x-user-id", "1")
  headers.set("x-user-role", role)
  return new NextRequest(new URL(`/api/patients/${id}/pin`, "http://test.local"), { method, headers })
}
const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  findFirstMock.mockResolvedValue({ id: 42 }) // patient alive by default
  canAccessMock.mockResolvedValue(true)
  consentMock.mockResolvedValue({ ok: true })
  rateLimitMock.mockResolvedValue({ allowed: true })
})

describe("POST /api/patients/[id]/pin", () => {
  it("VIEWER → 403 (RBAC NURSE+)", async () => {
    const res = await POST(req("VIEWER"), params("42"))
    expect(res?.status).toBe(403)
    expect(pinMock).not.toHaveBeenCalled()
  })

  it("404 when the patient does not exist / is soft-deleted", async () => {
    findFirstMock.mockResolvedValue(null)
    const res = await POST(req("NURSE"), params("42"))
    expect(res?.status).toBe(404)
  })

  it("out-of-perimeter → accessDenied + 403, no pin", async () => {
    canAccessMock.mockResolvedValue(false)
    const res = await POST(req("DOCTOR"), params("42"))
    expect(res?.status).toBe(403)
    expect(accessDeniedMock).toHaveBeenCalled()
    expect(pinMock).not.toHaveBeenCalled()
  })

  it("sharing disabled → blocked with consent status, no pin, NO accessDenied", async () => {
    consentMock.mockResolvedValue({ ok: false, status: 403, error: "sharingDisabled" })
    const res = await POST(req("NURSE"), params("42"))
    expect(res?.status).toBe(403)
    expect(pinMock).not.toHaveBeenCalled()
    // Un refus de consentement n'est PAS un accès refusé (accessDenied réservé
    // au hors-périmètre, pour ne pas polluer la détection d'abus US-2265).
    expect(accessDeniedMock).not.toHaveBeenCalled()
  })

  it("happy path → pins (200)", async () => {
    pinMock.mockResolvedValue({ ok: true })
    const res = await POST(req("NURSE"), params("42"))
    expect(res?.status).toBe(200)
    expect(pinMock).toHaveBeenCalledWith(1, 42, 1, expect.anything())
  })

  it("cap reached → 409", async () => {
    pinMock.mockResolvedValue({ ok: false, reason: "pinnedLimitReached" })
    const res = await POST(req("NURSE"), params("42"))
    expect(res?.status).toBe(409)
  })

  it("invalid id → 400", async () => {
    const res = await POST(req("NURSE", "POST", "abc"), params("abc"))
    expect(res?.status).toBe(400)
  })
})

describe("DELETE /api/patients/[id]/pin", () => {
  it("happy path → unpins (200)", async () => {
    unpinMock.mockResolvedValue(undefined)
    const res = await DELETE(req("NURSE", "DELETE"), params("42"))
    expect(res?.status).toBe(200)
    expect(unpinMock).toHaveBeenCalledWith(1, 42, 1, expect.anything())
  })
})

describe("GET /api/patients/recent", () => {
  it("VIEWER → 403 (RBAC NURSE+)", async () => {
    const headers = new Headers()
    headers.set("x-user-id", "1")
    headers.set("x-user-role", "VIEWER")
    const res = await GET_RECENT(
      new NextRequest(new URL("/api/patients/recent", "http://test.local"), { headers }),
    )
    expect(res?.status).toBe(403)
    expect(listMock).not.toHaveBeenCalled()
  })

  it("rate-limited → 429 with no-store, no service call", async () => {
    rateLimitMock.mockResolvedValue({ allowed: false, retryAfterSec: 30 })
    const headers = new Headers()
    headers.set("x-user-id", "1")
    headers.set("x-user-role", "NURSE")
    const res = await GET_RECENT(
      new NextRequest(new URL("/api/patients/recent", "http://test.local"), { headers }),
    )
    expect(res?.status).toBe(429)
    expect(res?.headers.get("Cache-Control")).toContain("no-store")
    expect(listMock).not.toHaveBeenCalled()
  })

  it("NURSE → 200 with recent+pinned, no-store header", async () => {
    listMock.mockResolvedValue({ recent: [], pinned: [] })
    const headers = new Headers()
    headers.set("x-user-id", "1")
    headers.set("x-user-role", "NURSE")
    const res = await GET_RECENT(
      new NextRequest(new URL("/api/patients/recent", "http://test.local"), { headers }),
    )
    expect(res?.status).toBe(200)
    expect(res?.headers.get("Cache-Control")).toContain("no-store")
    expect(listMock).toHaveBeenCalledWith(1, "NURSE", 1, expect.anything())
  })
})
