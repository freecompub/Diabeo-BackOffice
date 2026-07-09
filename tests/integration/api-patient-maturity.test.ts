/**
 * US-2657 — Route body-based de pose du niveau de maturité (`PATCH /api/patients/maturity`).
 * `patientId` dans le corps (transport fiche unifiée). Sécurité : **exactement DOCTOR** (NURSE/VIEWER/
 * ADMIN → 403 ; un patient VIEWER ne peut JAMAIS s'auto-élever, AC-1), anti-IDOR (→ 404), validation.
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
vi.mock("@/lib/services/patient.service", () => ({ patientService: { setMaturityLevel: vi.fn() } }))
vi.mock("@/lib/services/audit.service", () => ({
  extractRequestContext: vi.fn().mockReturnValue({ ipAddress: "127.0.0.1", userAgent: "test", requestId: "req-1" }),
  auditService: { log: vi.fn().mockResolvedValue(undefined), rateLimited: vi.fn().mockResolvedValue({}) },
}))

const { PATCH } = await import("@/app/api/patients/maturity/route")
const { resolvePatientId } = await import("@/lib/access-control")
const { checkApiRateLimit } = await import("@/lib/auth/api-rate-limit")
const { patientService } = await import("@/lib/services/patient.service")
const { auditService } = await import("@/lib/services/audit.service")

const resolve = vi.mocked(resolvePatientId)
const rateLimit = vi.mocked(checkApiRateLimit)
const setLevel = vi.mocked(patientService.setMaturityLevel)

function req(role: string, body: unknown): NextRequest {
  return new NextRequest(new URL("http://localhost/api/patients/maturity"), {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-user-id": "42", "x-user-role": role },
    body: JSON.stringify(body),
  })
}

describe("PATCH /api/patients/maturity", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolve.mockResolvedValue(7)
    rateLimit.mockResolvedValue({ allowed: true, remaining: 19, retryAfterSec: 60 } as never)
    setLevel.mockResolvedValue({ maturityLevel: "INTERMEDIATE", changed: true } as never)
  })

  it("rate-limit dépassé → 429 + Retry-After, service NON appelé (throttle avant le gate de rôle)", async () => {
    rateLimit.mockResolvedValue({ allowed: false, remaining: 0, retryAfterSec: 30 } as never)
    const res = await PATCH(req("DOCTOR", { patientId: 7, level: "INTERMEDIATE" }))
    expect(res.status).toBe(429)
    expect(res.headers.get("Retry-After")).toBe("30")
    expect(setLevel).not.toHaveBeenCalled()
  })

  it("VIEWER au plafond → 429 (PAS 403) : verrouille l'ordre throttle → gate de rôle", async () => {
    // Un non-DOCTOR qui sature reçoit 429 (rate-limit d'abord), pas 403 : garantit que le throttle précède
    // le gate de rôle (cap le flood d'audits MATURITY_LEVEL_SELF_ELEVATION_DENIED).
    rateLimit.mockResolvedValue({ allowed: false, remaining: 0, retryAfterSec: 15 } as never)
    const res = await PATCH(req("VIEWER", { patientId: 7, level: "EXPERT" }))
    expect(res.status).toBe(429)
    expect(auditService.log).not.toHaveBeenCalled() // pas d'audit self-elevation : on n'a pas atteint le gate
  })

  it("DOCTOR pose le niveau (patientId du corps) → 200, service appelé", async () => {
    const res = await PATCH(req("DOCTOR", { patientId: 7, level: "INTERMEDIATE" }))
    expect(res.status).toBe(200)
    expect(resolve).toHaveBeenCalledWith(42, "DOCTOR", 7)
    expect(setLevel).toHaveBeenCalledWith(7, "INTERMEDIATE", 42, expect.anything())
  })

  it("NURSE → 403", async () => {
    expect((await PATCH(req("NURSE", { patientId: 7, level: "EXPERT" }))).status).toBe(403)
    expect(setLevel).not.toHaveBeenCalled()
  })

  it("VIEWER (patient) → 403 : pas d'auto-élévation (AC-1)", async () => {
    expect((await PATCH(req("VIEWER", { patientId: 7, level: "EXPERT" }))).status).toBe(403)
    expect(setLevel).not.toHaveBeenCalled()
  })

  it("ADMIN (non-clinicien) → 403 (exactement DOCTOR)", async () => {
    expect((await PATCH(req("ADMIN", { patientId: 7, level: "INTERMEDIATE" }))).status).toBe(403)
    expect(setLevel).not.toHaveBeenCalled()
  })

  it("niveau invalide → 400", async () => {
    expect((await PATCH(req("DOCTOR", { patientId: 7, level: "GURU" }))).status).toBe(400)
    expect(setLevel).not.toHaveBeenCalled()
  })

  it("patient hors périmètre → 404 (anti-IDOR)", async () => {
    resolve.mockResolvedValue(null)
    expect((await PATCH(req("DOCTOR", { patientId: 99, level: "EXPERT" }))).status).toBe(404)
    expect(setLevel).not.toHaveBeenCalled()
  })
})
