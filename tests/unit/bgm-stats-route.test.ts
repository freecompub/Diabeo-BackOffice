/**
 * Test — GET /api/analytics/bgm-stats : gardes US-2638 (garde-fou épopée). Opt-out du
 * sujet (`patientShareConsent`), trace d'accès refusé (US-2265), et validation
 * Zod avant lecture consentement. Alignée sur glycemic-profile.
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
vi.mock("@/lib/services/analytics.service", () => ({ analyticsService: { bgmStats: vi.fn() } }))
vi.mock("@/lib/services/audit.service", () => ({
  extractRequestContext: vi.fn(() => ({ ipAddress: "i", userAgent: "u", requestId: "r" })),
}))
vi.mock("@/lib/audit/analytics-helpers", () => ({ auditAnalyticsAccessDenied: vi.fn() }))

import { GET } from "@/app/api/analytics/bgm-stats/route"
import { requireAuth } from "@/lib/auth"
import { checkApiRateLimit } from "@/lib/auth/api-rate-limit"
import { requireGdprConsent } from "@/lib/gdpr"
import { patientShareConsent } from "@/lib/consent"
import { resolvePatientIdFromQuery } from "@/lib/auth/query-helpers"
import { analyticsService } from "@/lib/services/analytics.service"
import { auditAnalyticsAccessDenied } from "@/lib/audit/analytics-helpers"

const makeReq = (period = "30d") => ({ nextUrl: { searchParams: new URLSearchParams({ period }) } }) as any
const mAuth = vi.mocked(requireAuth)
const mRate = vi.mocked(checkApiRateLimit)
const mGdpr = vi.mocked(requireGdprConsent)
const mShare = vi.mocked(patientShareConsent)
const mResolve = vi.mocked(resolvePatientIdFromQuery)
const mBgm = vi.mocked(analyticsService.bgmStats)
const mDenied = vi.mocked(auditAnalyticsAccessDenied)

beforeEach(() => {
  vi.clearAllMocks()
  mAuth.mockReturnValue({ id: 1, role: "DOCTOR" } as any)
  mRate.mockResolvedValue({ allowed: true } as any)
  mGdpr.mockResolvedValue(true)
  mResolve.mockResolvedValue({ patientId: 42 } as any)
  mShare.mockResolvedValue({ ok: true } as any)
  mBgm.mockResolvedValue([] as any)
})

describe("GET /api/analytics/bgm-stats — gardes US-2638", () => {
  it("blocks a patient who opted out of provider sharing (before projection)", async () => {
    mShare.mockResolvedValue({ ok: false, status: 403, error: "sharingDisabled" } as any)
    const r = await GET(makeReq())
    expect(r.status).toBe(403)
    expect(mBgm).not.toHaveBeenCalled()
  })

  it("passes through when consent is granted", async () => {
    const r = await GET(makeReq())
    expect(r.status).toBe(200)
    expect(mShare).toHaveBeenCalledWith(42)
    expect(mBgm).toHaveBeenCalledWith(42, "30d", 1, expect.any(Object))
  })

  it("audits accessDenied on out-of-scope resolution (US-2265)", async () => {
    mResolve.mockResolvedValue({ error: "patientNotFound" } as any)
    const r = await GET(makeReq())
    expect(r.status).toBe(404)
    expect(mDenied).toHaveBeenCalledTimes(1)
    expect(mShare).not.toHaveBeenCalled()
  })

  it("validates the period (400) BEFORE reading share consent", async () => {
    const r = await GET(makeReq("bogus"))
    expect(r.status).toBe(400)
    expect(mShare).not.toHaveBeenCalled()
    expect(mBgm).not.toHaveBeenCalled()
  })
})
