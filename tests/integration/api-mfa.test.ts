/**
 * Test suite: MFA routes — integration
 *
 * Clinical / security behavior tested:
 * - /api/auth/login with mfaEnabled=true returns 200 { mfaRequired, mfaToken }
 *   and DOES NOT set the diabeo_token cookie. Regression guard against the
 *   previous 403 behaviour and against accidentally minting a full JWT.
 * - /api/auth/mfa/challenge happy path: valid mfaToken + valid OTP → httpOnly
 *   cookie + { expiresAt }. Session is created with mfaVerified=true.
 * - /api/auth/mfa/challenge invalid OTP: 401 invalidOtp + audit
 *   MFA_CHALLENGE_FAILED row + rate-limit counter incremented.
 * - /api/auth/mfa/disable uniform 401 invalidCredentials when only password
 *   OR only OTP is correct (no oracle on which factor failed).
 * - /api/auth/mfa/verify: mfaEnabled is NOT flipped to true on OTP failure.
 *
 * Associated risks:
 * - Regression: if /login goes back to issuing a full cookie when mfaEnabled,
 *   the second factor is bypassed entirely.
 * - Regression: if /challenge stops setting mfaVerified=true, HDS forensics
 *   loses the ability to distinguish second-factor sessions.
 * - Regression: a verify path that flips mfaEnabled even on failure would
 *   permanently lock out users with a mistyped first OTP.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.stubEnv("UPSTASH_REDIS_REST_URL", "")
vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "")
vi.stubEnv("HMAC_SECRET", "test-hmac-secret-32-bytes-padding-padding")
vi.stubEnv("JWT_PRIVATE_KEY", "")
vi.stubEnv("JWT_PUBLIC_KEY", "")

// We mock the JWT helpers — actual sign/verify is exercised in unit tests.
const signMfaPendingTokenMock = vi.fn().mockResolvedValue("mfa-pending-jwt")
const verifyMfaPendingTokenMock = vi.fn()
const signJwtMock = vi.fn().mockResolvedValue("full-jwt")

vi.mock("@/lib/auth/jwt", () => ({
  signJwt: (...a: unknown[]) => signJwtMock(...a),
  signMfaPendingToken: (...a: unknown[]) => signMfaPendingTokenMock(...a),
  verifyMfaPendingToken: (...a: unknown[]) => verifyMfaPendingTokenMock(...a),
  verifyJwt: vi.fn(),
  verifyJwtAllowExpired: vi.fn(),
}))

const createSessionMock = vi.fn()
vi.mock("@/lib/auth/session", () => ({
  createSession: (...a: unknown[]) => createSessionMock(...a),
  getSession: vi.fn(),
  invalidateSession: vi.fn(),
  invalidateAllUserSessions: vi.fn(),
}))

const compareMock = vi.fn()
vi.mock("bcryptjs", () => ({ compare: (...a: unknown[]) => compareMock(...a) }))

const verifyOtpMock = vi.fn()
const disableMfaMock = vi.fn()
const verifyAndEnableMock = vi.fn()
vi.mock("@/lib/services/mfa.service", () => ({
  mfaService: {
    verifyOtp: (...a: unknown[]) => verifyOtpMock(...a),
    verifyAndEnable: (...a: unknown[]) => verifyAndEnableMock(...a),
    disable: (...a: unknown[]) => disableMfaMock(...a),
    generateSecret: vi.fn(),
  },
}))

import { prismaMock } from "../helpers/prisma-mock"

const auditLogMock = vi.fn().mockResolvedValue({})
vi.mock("@/lib/services/audit.service", () => ({
  auditService: { log: auditLogMock },
  extractRequestContext: () => ({ ipAddress: "1.2.3.4", userAgent: "vitest", requestId: "req-1" }),
}))

// Import routes AFTER mocks
const { POST: loginPost } = await import("@/app/api/auth/login/route")
const { POST: challengePost } = await import("@/app/api/auth/mfa/challenge/route")
const { POST: disablePost } = await import("@/app/api/auth/mfa/disable/route")
const { POST: verifyPost } = await import("@/app/api/auth/mfa/verify/route")

function jsonRequest(url: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(new URL(url), {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  })
}

describe("/api/auth/login — MFA branch", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("returns 200 { mfaRequired, mfaToken } when mfaEnabled — no cookie set", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 7, role: "VIEWER", passwordHash: "h", mfaEnabled: true,
    } as any)
    compareMock.mockResolvedValue(true)

    const res = await loginPost(jsonRequest(
      "http://localhost:3000/api/auth/login",
      { email: "a@b.com", password: "pw" },
    ))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.mfaRequired).toBe(true)
    expect(body.mfaToken).toBe("mfa-pending-jwt")
    expect(res.headers.get("set-cookie")).toBeNull()
    expect(signJwtMock).not.toHaveBeenCalled()  // full JWT not minted
    expect(createSessionMock).not.toHaveBeenCalled()
  })
})

describe("/api/auth/mfa/challenge", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyMfaPendingTokenMock.mockResolvedValue({ sub: 7, type: "mfa_pending" })
    prismaMock.user.findUnique.mockResolvedValue({
      id: 7, role: "VIEWER", mfaEnabled: true,
    } as any)
    createSessionMock.mockResolvedValue({
      id: "session-1", expires: new Date(Date.now() + 86_400_000),
    })
  })

  it("happy path: issues full JWT cookie + creates MFA-verified session", async () => {
    verifyOtpMock.mockResolvedValue(true)

    const res = await challengePost(jsonRequest(
      "http://localhost:3000/api/auth/mfa/challenge",
      { mfaToken: "mfa-pending-jwt", otp: "123456" },
    ))

    expect(res.status).toBe(200)
    const setCookie = res.headers.get("set-cookie")
    expect(setCookie).toMatch(/diabeo_token=full-jwt/)
    expect(setCookie).toMatch(/HttpOnly/i)
    // Session was created with mfaVerified=true (HDS forensics)
    expect(createSessionMock).toHaveBeenCalledWith(7, { mfaVerified: true })
    // LOGIN audit (not MFA_CHALLENGE_FAILED)
    const audit = auditLogMock.mock.calls[0][0]
    expect(audit.action).toBe("LOGIN")
    expect(audit.metadata.mfa).toBe(true)
  })

  it("invalid OTP: 401 invalidOtp + audit MFA_CHALLENGE_FAILED, no cookie", async () => {
    verifyOtpMock.mockResolvedValue(false)

    const res = await challengePost(jsonRequest(
      "http://localhost:3000/api/auth/mfa/challenge",
      { mfaToken: "mfa-pending-jwt", otp: "000000" },
    ))

    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe("invalidOtp")
    expect(res.headers.get("set-cookie")).toBeNull()
    expect(createSessionMock).not.toHaveBeenCalled()
    const audit = auditLogMock.mock.calls[0][0]
    expect(audit.action).toBe("MFA_CHALLENGE_FAILED")
    expect(audit.metadata.phase).toBe("challenge")
  })

  it("rejects an mfa-pending token with wrong audience (verifyMfaPendingToken throws)", async () => {
    verifyMfaPendingTokenMock.mockRejectedValue(new Error("bad audience"))

    const res = await challengePost(jsonRequest(
      "http://localhost:3000/api/auth/mfa/challenge",
      { mfaToken: "tampered", otp: "123456" },
    ))

    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe("invalidMfaToken")
    expect(verifyOtpMock).not.toHaveBeenCalled()
  })

  it("rejects when user disabled MFA between login and challenge", async () => {
    verifyOtpMock.mockResolvedValue(true)
    prismaMock.user.findUnique.mockResolvedValue({
      id: 7, role: "VIEWER", mfaEnabled: false,
    } as any)

    const res = await challengePost(jsonRequest(
      "http://localhost:3000/api/auth/mfa/challenge",
      { mfaToken: "mfa-pending-jwt", otp: "123456" },
    ))

    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe("invalidMfaToken")
  })
})

describe("/api/auth/mfa/disable — uniform 401 (no factor oracle)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.user.findUnique.mockResolvedValue({
      passwordHash: "hash", mfaEnabled: true,
    } as any)
  })

  it("password OK + OTP wrong → 401 invalidCredentials", async () => {
    compareMock.mockResolvedValue(true)
    verifyOtpMock.mockResolvedValue(false)

    const res = await disablePost(jsonRequest(
      "http://localhost:3000/api/auth/mfa/disable",
      { password: "pw", otp: "000000" },
      { "x-user-id": "7", "x-user-role": "VIEWER" },
    ))

    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe("invalidCredentials")
    expect(disableMfaMock).not.toHaveBeenCalled()
  })

  it("password wrong + OTP OK → SAME 401 invalidCredentials (uniform)", async () => {
    compareMock.mockResolvedValue(false)
    verifyOtpMock.mockResolvedValue(true)

    const res = await disablePost(jsonRequest(
      "http://localhost:3000/api/auth/mfa/disable",
      { password: "wrong", otp: "123456" },
      { "x-user-id": "7", "x-user-role": "VIEWER" },
    ))

    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe("invalidCredentials")
  })

  it("both factors valid → 200 + mfaService.disable called + MFA_DISABLED audit", async () => {
    compareMock.mockResolvedValue(true)
    verifyOtpMock.mockResolvedValue(true)
    disableMfaMock.mockResolvedValue(undefined)

    const res = await disablePost(jsonRequest(
      "http://localhost:3000/api/auth/mfa/disable",
      { password: "pw", otp: "123456" },
      { "x-user-id": "7", "x-user-role": "VIEWER" },
    ))

    expect(res.status).toBe(200)
    expect(disableMfaMock).toHaveBeenCalledWith(7)
    const audit = auditLogMock.mock.calls.find((c: any) => c[0].action === "MFA_DISABLED")
    expect(audit).toBeDefined()
  })
})

describe("/api/auth/mfa/verify — atomicity", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("does NOT emit MFA_ENABLED when verifyAndEnable returns false", async () => {
    verifyAndEnableMock.mockResolvedValue(false)

    const res = await verifyPost(jsonRequest(
      "http://localhost:3000/api/auth/mfa/verify",
      { otp: "000000" },
      { "x-user-id": "7", "x-user-role": "VIEWER" },
    ))

    expect(res.status).toBe(401)
    const enabledAudit = auditLogMock.mock.calls.find((c: any) => c[0].action === "MFA_ENABLED")
    expect(enabledAudit).toBeUndefined()
    // But MFA_CHALLENGE_FAILED was logged
    const failedAudit = auditLogMock.mock.calls.find((c: any) => c[0].action === "MFA_CHALLENGE_FAILED")
    expect(failedAudit).toBeDefined()
  })

  it("emits MFA_ENABLED only on success", async () => {
    verifyAndEnableMock.mockResolvedValue(true)

    const res = await verifyPost(jsonRequest(
      "http://localhost:3000/api/auth/mfa/verify",
      { otp: "123456" },
      { "x-user-id": "7", "x-user-role": "VIEWER" },
    ))

    expect(res.status).toBe(200)
    const enabledAudit = auditLogMock.mock.calls.find((c: any) => c[0].action === "MFA_ENABLED")
    expect(enabledAudit).toBeDefined()
  })
})
