/**
 * Test — GET /api/analytics/glycemic-profile : garde `patientShareConsent`
 * (US-2634, garde-fou épopée fiche patient). La route sert les KPI re-fetchés à
 * la période (page `?patientId=` + drawer `cTok`) ; un patient en opt-out de
 * partage ne doit pas être exposé, même à un PS RBAC-autorisé. Les autres
 * gardes (auth, rate-limit, résolution) ont leurs suites — ici on isole le gate
 * consentement sujet + le pass-through nominal.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
  AuthError: class AuthError extends Error {
    status = 401
  },
}))
vi.mock("@/lib/auth/api-rate-limit", () => ({
  checkApiRateLimit: vi.fn(),
  RATE_LIMITS: { analytics: { points: 1, durationSec: 1 } },
}))
vi.mock("@/lib/gdpr", () => ({ requireGdprConsent: vi.fn() }))
vi.mock("@/lib/consent", () => ({ patientShareConsent: vi.fn() }))
vi.mock("@/lib/auth/query-helpers", () => ({ resolvePatientIdFromQuery: vi.fn() }))
vi.mock("@/lib/services/analytics.service", () => ({
  analyticsService: { glycemicProfile: vi.fn() },
}))
vi.mock("@/lib/services/audit.service", () => ({
  extractRequestContext: vi.fn(() => ({ ipAddress: "i", userAgent: "u", requestId: "r" })),
}))
vi.mock("@/lib/audit/analytics-helpers", () => ({ auditAnalyticsAccessDenied: vi.fn() }))

import { GET } from "@/app/api/analytics/glycemic-profile/route"
import { requireAuth } from "@/lib/auth"
import { checkApiRateLimit } from "@/lib/auth/api-rate-limit"
import { requireGdprConsent } from "@/lib/gdpr"
import { patientShareConsent } from "@/lib/consent"
import { resolvePatientIdFromQuery } from "@/lib/auth/query-helpers"
import { analyticsService } from "@/lib/services/analytics.service"
import { auditAnalyticsAccessDenied } from "@/lib/audit/analytics-helpers"

const makeReq = (period = "30d") =>
  ({ nextUrl: { searchParams: new URLSearchParams({ period }) } }) as any
const mAuth = vi.mocked(requireAuth)
const mRate = vi.mocked(checkApiRateLimit)
const mGdpr = vi.mocked(requireGdprConsent)
const mShare = vi.mocked(patientShareConsent)
const mResolve = vi.mocked(resolvePatientIdFromQuery)
const mProfile = vi.mocked(analyticsService.glycemicProfile)
const mDenied = vi.mocked(auditAnalyticsAccessDenied)

beforeEach(() => {
  vi.clearAllMocks()
  mAuth.mockReturnValue({ id: 1, role: "DOCTOR" } as any)
  mRate.mockResolvedValue({ allowed: true } as any)
  mGdpr.mockResolvedValue(true)
  mResolve.mockResolvedValue({ patientId: 42 } as any)
  mShare.mockResolvedValue({ ok: true } as any)
  mProfile.mockResolvedValue({ period: { days: 30 } } as any)
})

describe("GET /api/analytics/glycemic-profile — patientShareConsent gate", () => {
  it("blocks a patient who opted out of provider sharing (before any projection)", async () => {
    mShare.mockResolvedValue({ ok: false, status: 403, error: "sharingDisabled" } as any)
    const r = await GET(makeReq())
    expect(r.status).toBe(403)
    expect(await r.json()).toEqual({ error: "sharingDisabled" })
    expect(mProfile).not.toHaveBeenCalled()
  })

  it("passes through to the profile when consent is granted", async () => {
    const r = await GET(makeReq())
    expect(r.status).toBe(200)
    expect(mShare).toHaveBeenCalledWith(42)
    expect(mProfile).toHaveBeenCalledWith(42, "30d", 1, expect.any(Object))
  })

  it("audits accessDenied on out-of-scope resolution (US-2265)", async () => {
    mResolve.mockResolvedValue({ error: "patientNotFound" } as any)
    const r = await GET(makeReq())
    expect(r.status).toBe(404)
    expect(mDenied).toHaveBeenCalledTimes(1)
    expect(mShare).not.toHaveBeenCalled()
  })

  it("validates the period (400) BEFORE reading share consent (no DB round-trip)", async () => {
    const r = await GET(makeReq("bogus"))
    expect(r.status).toBe(400)
    expect(await r.json()).toEqual({ error: "validationFailed" })
    expect(mShare).not.toHaveBeenCalled()
    expect(mProfile).not.toHaveBeenCalled()
  })
})
