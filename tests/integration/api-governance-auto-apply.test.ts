/**
 * US-2657 (slice C) — Route de gouvernance `PATCH /api/governance/auto-apply` (frontière MDR).
 * Sécurité : **ADMIN seulement** (DOCTOR/NURSE/VIEWER → 403) ; activer exige une référence (→ 400) ;
 * anti-IDOR (→ 404) ; désactivation permise.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/db/client", () => ({ prisma: {} }))
vi.mock("@/lib/gdpr", () => ({ requireGdprConsent: vi.fn().mockResolvedValue(true) }))
vi.mock("@/lib/access-control", () => ({ resolvePatientId: vi.fn() }))
vi.mock("@/lib/auth/api-rate-limit", () => ({
  checkApiRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 19, retryAfterSec: 60 }),
  RATE_LIMITS: { governanceMutation: { bucket: "governance-mutation", windowSec: 60, max: 20, failMode: "open" } },
}))
vi.mock("@/lib/services/governance.service", () => ({ governanceService: { setAutoApply: vi.fn() } }))
vi.mock("@/lib/services/audit.service", () => ({
  extractRequestContext: vi.fn().mockReturnValue({ ipAddress: "127.0.0.1", userAgent: "test" }),
  auditService: { rateLimited: vi.fn().mockResolvedValue({}) },
}))

const { PATCH } = await import("@/app/api/governance/auto-apply/route")
const { resolvePatientId } = await import("@/lib/access-control")
const { checkApiRateLimit } = await import("@/lib/auth/api-rate-limit")
const { governanceService } = await import("@/lib/services/governance.service")

const resolve = vi.mocked(resolvePatientId)
const rateLimit = vi.mocked(checkApiRateLimit)
const setFlag = vi.mocked(governanceService.setAutoApply)

function req(role: string, body: unknown): NextRequest {
  return new NextRequest(new URL("http://localhost/api/governance/auto-apply"), {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-user-id": "3", "x-user-role": role },
    body: JSON.stringify(body),
  })
}

describe("PATCH /api/governance/auto-apply", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolve.mockResolvedValue(7)
    rateLimit.mockResolvedValue({ allowed: true, remaining: 19, retryAfterSec: 60 } as never)
    setFlag.mockResolvedValue({ autoApply: true, changed: true } as never)
  })

  it("rate-limit dépassé → 429 + Retry-After, service NON appelé", async () => {
    rateLimit.mockResolvedValue({ allowed: false, remaining: 0, retryAfterSec: 42 } as never)
    const res = await PATCH(req("ADMIN", { patientId: 7, enabled: true, reference: "GOV-1", dpiaRef: "DPIA-1" }))
    expect(res.status).toBe(429)
    expect(res.headers.get("Retry-After")).toBe("42")
    expect(setFlag).not.toHaveBeenCalled()
  })

  it("ADMIN active avec référence → 200", async () => {
    const res = await PATCH(req("ADMIN", { patientId: 7, enabled: true, reference: "GOV-1", dpiaRef: "DPIA-1" }))
    expect(res.status).toBe(200)
    expect(setFlag).toHaveBeenCalledWith(7, true, { reference: "GOV-1", dpiaRef: "DPIA-1" }, 3, expect.anything())
  })

  it("ADMIN désactive sans référence → 200", async () => {
    setFlag.mockResolvedValue({ autoApply: false, changed: true } as never)
    const res = await PATCH(req("ADMIN", { patientId: 7, enabled: false }))
    expect(res.status).toBe(200)
    expect(setFlag).toHaveBeenCalledWith(7, false, null, 3, expect.anything())
  })

  it("activation SANS référence → 400 (ne pose rien)", async () => {
    const res = await PATCH(req("ADMIN", { patientId: 7, enabled: true }))
    expect(res.status).toBe(400)
    expect(setFlag).not.toHaveBeenCalled()
  })

  it("activation SANS dpiaRef → 400 (DPIA obligatoire)", async () => {
    const res = await PATCH(req("ADMIN", { patientId: 7, enabled: true, reference: "GOV-1" }))
    expect(res.status).toBe(400)
    expect(setFlag).not.toHaveBeenCalled()
  })

  for (const role of ["DOCTOR", "NURSE", "VIEWER"]) {
    it(`${role} → 403 (acte de gouvernance réservé ADMIN)`, async () => {
      const res = await PATCH(req(role, { patientId: 7, enabled: true, reference: "GOV-1" }))
      expect(res.status).toBe(403)
      expect(setFlag).not.toHaveBeenCalled()
    })
  }

  it("patient hors périmètre → 404 (anti-IDOR)", async () => {
    resolve.mockResolvedValue(null)
    const res = await PATCH(req("ADMIN", { patientId: 99, enabled: true, reference: "GOV-1", dpiaRef: "DPIA-1" }))
    expect(res.status).toBe(404)
    expect(setFlag).not.toHaveBeenCalled()
  })
})
