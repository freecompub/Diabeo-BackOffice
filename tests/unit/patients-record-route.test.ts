/**
 * Test suite — GET /api/patients/record (US-2633).
 *
 * Surface de sécurité : la route alimente la fiche patient (page + drawer cTok).
 * On vérifie la chaîne de gardes AVANT projection — rate-limit → consentement
 * appelant (RGPD) → résolution + scope patient → **opt-out du sujet**
 * (`patientShareConsent`) — et le câblage (assemblage + audit « surface » sans
 * PHI + trace `accessDenied` sur refus pour la détection US-2265). Les gardes
 * sous-jacentes ont leurs propres suites — ici on mocke pour isoler le contrat.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
  getAuthUser: vi.fn(),
  AuthError: class AuthError extends Error {
    status: number
    constructor(message = "unauthorized", status = 401) {
      super(message)
      this.status = status
    }
  },
}))
vi.mock("@/lib/auth/api-rate-limit", () => ({
  checkApiRateLimit: vi.fn(),
  RATE_LIMITS: { analytics: { points: 1, durationSec: 1 } },
}))
vi.mock("@/lib/gdpr", () => ({ requireGdprConsent: vi.fn() }))
vi.mock("@/lib/consent", () => ({ patientShareConsent: vi.fn() }))
vi.mock("@/lib/auth/query-helpers", () => ({ resolvePatientIdFromQuery: vi.fn() }))
vi.mock("@/lib/services/audit.service", () => ({
  auditService: { log: vi.fn(), accessDenied: vi.fn(), rateLimited: vi.fn() },
  extractRequestContext: vi.fn(() => ({ ipAddress: "i", userAgent: "u", requestId: "r" })),
}))
vi.mock("@/app/(dashboard)/patients/[id]/build-patient-record", () => ({
  buildPatientRecordData: vi.fn(),
}))

import { GET } from "@/app/api/patients/record/route"
import { requireAuth, getAuthUser, AuthError } from "@/lib/auth"
import { checkApiRateLimit } from "@/lib/auth/api-rate-limit"
import { requireGdprConsent } from "@/lib/gdpr"
import { patientShareConsent } from "@/lib/consent"
import { resolvePatientIdFromQuery } from "@/lib/auth/query-helpers"
import { buildPatientRecordData } from "@/app/(dashboard)/patients/[id]/build-patient-record"
import { auditService } from "@/lib/services/audit.service"

const makeReq = (patientId?: string) =>
  ({ nextUrl: { searchParams: new URLSearchParams(patientId ? { patientId } : {}) } }) as any

const mAuth = vi.mocked(requireAuth)
const mGetUser = vi.mocked(getAuthUser)
const mRate = vi.mocked(checkApiRateLimit)
const mConsent = vi.mocked(requireGdprConsent)
const mShare = vi.mocked(patientShareConsent)
const mResolve = vi.mocked(resolvePatientIdFromQuery)
const mBuild = vi.mocked(buildPatientRecordData)
const mLog = vi.mocked(auditService.log)
const mDenied = vi.mocked(auditService.accessDenied)
const mRateLimited = vi.mocked(auditService.rateLimited)

beforeEach(() => {
  vi.clearAllMocks()
  mAuth.mockReturnValue({ id: 1, role: "DOCTOR" } as any)
  mRate.mockResolvedValue({ allowed: true } as any)
  mConsent.mockResolvedValue(true)
  mResolve.mockResolvedValue({ patientId: 42 } as any)
  mShare.mockResolvedValue({ ok: true } as any)
  mBuild.mockResolvedValue({ id: 42, name: "X" } as any)
  mLog.mockResolvedValue(undefined as any)
  mDenied.mockResolvedValue(undefined as any)
  mRateLimited.mockResolvedValue(undefined as any)
})

describe("GET /api/patients/record", () => {
  it("401 when unauthenticated (audits accessDenied only on 403)", async () => {
    mAuth.mockImplementation(() => {
      throw new (AuthError as any)("unauthorized", 401)
    })
    const r = await GET(makeReq())
    expect(r.status).toBe(401)
    expect(mDenied).not.toHaveBeenCalled()
    expect(mBuild).not.toHaveBeenCalled()
  })

  it("403 forbidden token → audits accessDenied", async () => {
    mAuth.mockImplementation(() => {
      throw new (AuthError as any)("forbidden", 403)
    })
    mGetUser.mockReturnValue({ id: 7, role: "DOCTOR" } as any)
    const r = await GET(makeReq())
    expect(r.status).toBe(403)
    expect(mDenied).toHaveBeenCalledTimes(1)
    expect((mDenied.mock.calls[0]![0] as any).resourceId).toBe("record")
  })

  it("429 when rate limited → audits RATE_LIMITED, no resolution/projection", async () => {
    mRate.mockResolvedValue({ allowed: false, retryAfterSec: 30 } as any)
    const r = await GET(makeReq())
    expect(r.status).toBe(429)
    expect(r.headers.get("Retry-After")).toBe("30")
    expect(mRateLimited).toHaveBeenCalledTimes(1)
    expect(mResolve).not.toHaveBeenCalled()
    expect(mBuild).not.toHaveBeenCalled()
    expect(mLog).not.toHaveBeenCalled() // pas de ligne « surface » sur échec
  })

  it("403 when the caller has no GDPR consent (before any patient resolution)", async () => {
    mConsent.mockResolvedValue(false)
    const r = await GET(makeReq())
    expect(r.status).toBe(403)
    expect(mResolve).not.toHaveBeenCalled()
    expect(mBuild).not.toHaveBeenCalled()
  })

  it("400 when patientId is malformed (no accessDenied audit)", async () => {
    mResolve.mockResolvedValue({ error: "invalidPatientId" } as any)
    const r = await GET(makeReq("abc"))
    expect(r.status).toBe(400)
    expect(mBuild).not.toHaveBeenCalled()
    expect(mDenied).not.toHaveBeenCalled()
  })

  it("404 (uniform) on access denied / no patient via ?patientId= → audits the raw id (US-2265)", async () => {
    mResolve.mockResolvedValue({ error: "patientNotFound" } as any)
    const r = await GET(makeReq("99"))
    expect(r.status).toBe(404)
    expect(mBuild).not.toHaveBeenCalled()
    expect(mDenied).toHaveBeenCalledTimes(1)
    const arg = mDenied.mock.calls[0]![0] as any
    expect(arg.resourceId).toBe("99")
    expect(arg.metadata).toMatchObject({ surface: "api", kind: "patientRecord", reason: "patientNotFound" })
    expect(mLog).not.toHaveBeenCalled() // pas de ligne « surface » sur échec
  })

  it("404 on the cTok drawer path (no ?patientId=) → audits resourceId 'unknown'", async () => {
    mResolve.mockResolvedValue({ error: "patientNotFound" } as any)
    const r = await GET(makeReq()) // pas de ?patientId= → résolution par jeton
    expect(r.status).toBe(404)
    expect((mDenied.mock.calls[0]![0] as any).resourceId).toBe("unknown")
  })

  it("blocks a patient who opted out of provider sharing → 403 + audits accessDenied", async () => {
    mShare.mockResolvedValue({ ok: false, status: 403, error: "sharingDisabled" } as any)
    const r = await GET(makeReq())
    expect(r.status).toBe(403)
    expect(await r.json()).toEqual({ error: "sharingDisabled" })
    expect(mBuild).not.toHaveBeenCalled()
    expect(mDenied).toHaveBeenCalledTimes(1)
    expect((mDenied.mock.calls[0]![0] as any).metadata).toMatchObject({ kind: "sharingDisabled", surface: "api" })
  })

  it("blocks a patient with missing GDPR consent (patientConsentMissing, fail-closed)", async () => {
    mShare.mockResolvedValue({ ok: false, status: 403, error: "patientConsentMissing" } as any)
    const r = await GET(makeReq())
    expect(r.status).toBe(403)
    expect(await r.json()).toEqual({ error: "patientConsentMissing" })
    expect((mDenied.mock.calls[0]![0] as any).metadata).toMatchObject({ kind: "patientConsentMissing" })
  })

  it("does not audit a sharing-consent 404 (patient soft-deleted at consent check)", async () => {
    mShare.mockResolvedValue({ ok: false, status: 404, error: "patientNotFound" } as any)
    const r = await GET(makeReq())
    expect(r.status).toBe(404)
    expect(mDenied).not.toHaveBeenCalled()
  })

  it("404 (uniform) when the patient record cannot be built (deleted patient)", async () => {
    mBuild.mockResolvedValue(null)
    const r = await GET(makeReq())
    expect(r.status).toBe(404)
    expect(await r.json()).toEqual({ error: "patientNotFound" })
  })

  it("500 when assembly throws — without leaking the internal message", async () => {
    mBuild.mockRejectedValue(new Error("db boom secret"))
    const r = await GET(makeReq())
    expect(r.status).toBe(500)
    expect(await r.json()).toEqual({ error: "serverError" })
  })

  it("200 returns the DTO and writes a surface audit row (no PHI in metadata)", async () => {
    const r = await GET(makeReq())
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ id: 42, name: "X" })
    expect(mBuild).toHaveBeenCalledWith(42, "DOCTOR", 1, expect.any(Object))
    const data = mLog.mock.calls.at(-1)![0]
    expect(data.resource).toBe("PATIENT")
    expect(data.metadata).toEqual({ patientId: 42, kind: "patientRecord", surface: "api" })
  })

  it("still returns 200 if the surface audit write fails (fail-soft)", async () => {
    mLog.mockRejectedValue(new Error("audit down"))
    const r = await GET(makeReq())
    expect(r.status).toBe(200)
  })
})
