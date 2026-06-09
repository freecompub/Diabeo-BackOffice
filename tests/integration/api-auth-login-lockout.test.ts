/**
 * Test suite: /api/auth/login — A6 lockout feedback (PR #511 review M2)
 *
 * Security behavior tested:
 * - A6: the 429 lockout response must be returned on the *triggering* failed
 *   attempt (the 3rd), not the next one. After `recordFailedAttempt`, the route
 *   re-checks the rate limit and short-circuits to 429 if it just flipped.
 * - Anti-enumeration: the 429 body is byte-identical whether the email maps to
 *   a real user or not (`{ error: "tooManyAttempts", retryAfterSeconds }`).
 * - No double-count: `recordFailedAttempt` is called exactly once per attempt,
 *   so the second (read-only) `checkRateLimit` never shortens the lockout.
 * - Audit: known user → `auditService.rateLimited` (burst-aware, numeric userId);
 *   unknown email → `auditService.log` with `userId: null` (no FK, no existence
 *   leak). A normal (non-triggering) failure returns 401 invalidCredentials.
 *
 * Associated risks:
 * - Regression: if the post-attempt re-check is removed, the user only sees the
 *   lockout on the 4th attempt — the QA A6 anomaly this PR fixes.
 * - Regression: if `recordFailedAttempt` is called twice, the lockout window is
 *   silently shortened (DoS-adjacent / inconsistent UX).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.stubEnv("HMAC_SECRET", "test-hmac-secret-32-bytes-padding-padding")

// vi.mock factories are hoisted above the file body, so any variable they
// reference must be created via vi.hoisted() (else ReferenceError).
const { compareMock, findUniqueMock, auditLogMock, auditRateLimitedMock } = vi.hoisted(() => ({
  compareMock: vi.fn(),
  findUniqueMock: vi.fn(),
  auditLogMock: vi.fn().mockResolvedValue({}),
  auditRateLimitedMock: vi.fn().mockResolvedValue({}),
}))

vi.mock("@/lib/auth", () => ({
  checkRateLimit: vi.fn(),
  recordFailedAttempt: vi.fn().mockResolvedValue(undefined),
  clearAttempts: vi.fn().mockResolvedValue(undefined),
  signJwt: vi.fn().mockResolvedValue("full-jwt"),
  signMfaPendingToken: vi.fn().mockResolvedValue("mfa-jwt"),
  createSession: vi.fn().mockResolvedValue({ id: "sess1", expires: new Date() }),
}))

vi.mock("bcryptjs", () => ({ compare: (...a: unknown[]) => compareMock(...a) }))

vi.mock("@/lib/crypto/hmac", () => ({ hmacEmail: () => "email-hash" }))

vi.mock("@/lib/db/client", () => ({
  prisma: { user: { findUnique: (...a: unknown[]) => findUniqueMock(...a) } },
}))

vi.mock("@/lib/services/audit.service", () => ({
  auditService: { log: auditLogMock, rateLimited: auditRateLimitedMock },
  extractRequestContext: () => ({ ipAddress: "1.2.3.4", userAgent: "ua", requestId: "req-1" }),
}))

vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }))

import { POST } from "@/app/api/auth/login/route"
import { checkRateLimit, recordFailedAttempt } from "@/lib/auth"

const checkRateLimitMock = vi.mocked(checkRateLimit)
const recordFailedAttemptMock = vi.mocked(recordFailedAttempt)

function loginReq() {
  return new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "user@example.com", password: "Wrong-Password-123" }),
  })
}

const ACTIVE_USER = {
  id: 42,
  passwordHash: "$2a$12$hash",
  role: "VIEWER",
  mfaEnabled: false,
  status: "active",
}

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe("/api/auth/login — A6 lockout feedback", () => {
  it("known user: the triggering 3rd failure returns 429 (not 401)", async () => {
    findUniqueMock.mockResolvedValue(ACTIVE_USER)
    compareMock.mockResolvedValue(false) // wrong password
    // 1st checkRateLimit (pre-attempt) = not blocked; 2nd (post-attempt) = just locked.
    checkRateLimitMock
      .mockResolvedValueOnce({ blocked: false, retryAfterSeconds: 0 })
      .mockResolvedValueOnce({ blocked: true, retryAfterSeconds: 300 })

    const res = await POST(loginReq())
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: "tooManyAttempts", retryAfterSeconds: 300 })
    // No double-count: exactly one record per attempt.
    expect(recordFailedAttemptMock).toHaveBeenCalledTimes(1)
    // Known user → burst-aware audit with numeric userId.
    expect(auditRateLimitedMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 42, resource: "SESSION" }),
    )
  })

  it("unknown email: the triggering failure returns the SAME 429 body (anti-enumeration)", async () => {
    findUniqueMock.mockResolvedValue(null)
    compareMock.mockResolvedValue(false) // DUMMY_HASH compare
    checkRateLimitMock
      .mockResolvedValueOnce({ blocked: false, retryAfterSeconds: 0 })
      .mockResolvedValueOnce({ blocked: true, retryAfterSeconds: 300 })

    const res = await POST(loginReq())
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: "tooManyAttempts", retryAfterSeconds: 300 })
    expect(recordFailedAttemptMock).toHaveBeenCalledTimes(1)
    // Unknown email → anonymous audit (userId null, no FK, no existence leak).
    expect(auditRateLimitedMock).not.toHaveBeenCalled()
    expect(auditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: null,
        action: "RATE_LIMITED",
        resource: "SESSION",
        metadata: expect.objectContaining({ reason: "rateLimited", retryAfterSeconds: 300 }),
      }),
    )
  })

  it("known user: a non-triggering failure still returns 401 invalidCredentials", async () => {
    findUniqueMock.mockResolvedValue(ACTIVE_USER)
    compareMock.mockResolvedValue(false)
    // Both checks below the lockout threshold.
    checkRateLimitMock
      .mockResolvedValueOnce({ blocked: false, retryAfterSeconds: 0 })
      .mockResolvedValueOnce({ blocked: false, retryAfterSeconds: 0 })

    const res = await POST(loginReq())
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: "invalidCredentials" })
    expect(recordFailedAttemptMock).toHaveBeenCalledTimes(1)
    expect(auditRateLimitedMock).not.toHaveBeenCalled()
  })

  it("already locked (pre-attempt): 429 without recording a new attempt", async () => {
    checkRateLimitMock.mockResolvedValueOnce({ blocked: true, retryAfterSeconds: 120 })

    const res = await POST(loginReq())
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: "tooManyAttempts", retryAfterSeconds: 120 })
    // Already locked → do not even reach recordFailedAttempt.
    expect(recordFailedAttemptMock).not.toHaveBeenCalled()
    expect(findUniqueMock).not.toHaveBeenCalled()
    expect(auditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ reason: "alreadyLocked" }) }),
    )
  })
})
