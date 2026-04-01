/**
 * Unit tests for Phase 1 — Authentication & Account modules.
 * Tests: RBAC, rate limiting, HMAC, conversions, auth helpers.
 *
 * Note: Auth helpers import from @/lib/auth which cascades to session.ts → Prisma.
 * We mock Prisma to avoid connection issues in unit tests.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"

vi.mock("@/lib/db/client", () => ({
  prisma: {
    session: { create: vi.fn(), findUnique: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
  },
}))

// =========================================================================
// RBAC
// =========================================================================
describe("RBAC — hasMinRole", () => {
  let hasMinRole: typeof import("@/lib/auth/rbac").hasMinRole

  beforeEach(async () => {
    const mod = await import("@/lib/auth/rbac")
    hasMinRole = mod.hasMinRole
  })

  it("ADMIN has access to all roles", () => {
    expect(hasMinRole("ADMIN", "ADMIN")).toBe(true)
    expect(hasMinRole("ADMIN", "DOCTOR")).toBe(true)
    expect(hasMinRole("ADMIN", "NURSE")).toBe(true)
    expect(hasMinRole("ADMIN", "VIEWER")).toBe(true)
  })

  it("DOCTOR has access to DOCTOR and below", () => {
    expect(hasMinRole("DOCTOR", "ADMIN")).toBe(false)
    expect(hasMinRole("DOCTOR", "DOCTOR")).toBe(true)
    expect(hasMinRole("DOCTOR", "NURSE")).toBe(true)
    expect(hasMinRole("DOCTOR", "VIEWER")).toBe(true)
  })

  it("NURSE has access to NURSE and below", () => {
    expect(hasMinRole("NURSE", "ADMIN")).toBe(false)
    expect(hasMinRole("NURSE", "DOCTOR")).toBe(false)
    expect(hasMinRole("NURSE", "NURSE")).toBe(true)
    expect(hasMinRole("NURSE", "VIEWER")).toBe(true)
  })

  it("VIEWER only has access to VIEWER", () => {
    expect(hasMinRole("VIEWER", "ADMIN")).toBe(false)
    expect(hasMinRole("VIEWER", "DOCTOR")).toBe(false)
    expect(hasMinRole("VIEWER", "NURSE")).toBe(false)
    expect(hasMinRole("VIEWER", "VIEWER")).toBe(true)
  })
})

// =========================================================================
// Rate Limiting
// =========================================================================
describe("Rate Limiting", () => {
  let checkRateLimit: typeof import("@/lib/auth/rate-limit").checkRateLimit
  let recordFailedAttempt: typeof import("@/lib/auth/rate-limit").recordFailedAttempt
  let clearAttempts: typeof import("@/lib/auth/rate-limit").clearAttempts

  beforeEach(async () => {
    vi.resetModules()
    const mod = await import("@/lib/auth/rate-limit")
    checkRateLimit = mod.checkRateLimit
    recordFailedAttempt = mod.recordFailedAttempt
    clearAttempts = mod.clearAttempts
  })

  it("allows first attempt", () => {
    const result = checkRateLimit("user@test.com")
    expect(result.blocked).toBe(false)
  })

  it("allows 2 failed attempts without lockout", () => {
    recordFailedAttempt("user@test.com")
    recordFailedAttempt("user@test.com")
    const result = checkRateLimit("user@test.com")
    expect(result.blocked).toBe(false)
  })

  it("blocks after 3 failed attempts", () => {
    recordFailedAttempt("user@test.com")
    recordFailedAttempt("user@test.com")
    recordFailedAttempt("user@test.com")
    const result = checkRateLimit("user@test.com")
    expect(result.blocked).toBe(true)
    expect(result.retryAfterSeconds).toBeGreaterThan(0)
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(300)
  })

  it("clearAttempts resets the counter", () => {
    recordFailedAttempt("user@test.com")
    recordFailedAttempt("user@test.com")
    recordFailedAttempt("user@test.com")
    clearAttempts("user@test.com")
    const result = checkRateLimit("user@test.com")
    expect(result.blocked).toBe(false)
  })

  it("isolates different identifiers", () => {
    recordFailedAttempt("user1@test.com")
    recordFailedAttempt("user1@test.com")
    recordFailedAttempt("user1@test.com")
    expect(checkRateLimit("user1@test.com").blocked).toBe(true)
    expect(checkRateLimit("user2@test.com").blocked).toBe(false)
  })
})

// =========================================================================
// HMAC Email
// =========================================================================
describe("HMAC Email", () => {
  let hmacEmail: typeof import("@/lib/crypto/hmac").hmacEmail

  beforeEach(async () => {
    process.env.HMAC_SECRET = "test-hmac-secret-32-bytes-long!!"
    const mod = await import("@/lib/crypto/hmac")
    hmacEmail = mod.hmacEmail
  })

  afterEach(() => {
    delete process.env.HMAC_SECRET
  })

  it("produces a deterministic hex hash", () => {
    const hash1 = hmacEmail("test@example.com")
    const hash2 = hmacEmail("test@example.com")
    expect(hash1).toBe(hash2)
    expect(hash1).toMatch(/^[a-f0-9]{64}$/)
  })

  it("normalizes email to lowercase", () => {
    const hash1 = hmacEmail("Test@Example.COM")
    const hash2 = hmacEmail("test@example.com")
    expect(hash1).toBe(hash2)
  })

  it("different emails produce different hashes", () => {
    const hash1 = hmacEmail("user1@example.com")
    const hash2 = hmacEmail("user2@example.com")
    expect(hash1).not.toBe(hash2)
  })

  it("throws when HMAC_SECRET is not set", () => {
    delete process.env.HMAC_SECRET
    expect(() => hmacEmail("test@example.com")).toThrow("HMAC_SECRET is not set")
  })
})

// =========================================================================
// Auth helpers (getAuthUser, requireAuth, requireRole)
// =========================================================================
describe("Auth helpers", () => {
  let getAuthUser: typeof import("@/lib/auth").getAuthUser
  let requireAuth: typeof import("@/lib/auth").requireAuth
  let requireRole: typeof import("@/lib/auth").requireRole
  let AuthError: typeof import("@/lib/auth").AuthError

  beforeEach(async () => {
    const mod = await import("@/lib/auth")
    getAuthUser = mod.getAuthUser
    requireAuth = mod.requireAuth
    requireRole = mod.requireRole
    AuthError = mod.AuthError
  })

  function makeRequest(headers: Record<string, string> = {}): Request {
    return new Request("http://localhost/api/test", {
      headers: new Headers(headers),
    })
  }

  it("getAuthUser returns null without headers", () => {
    const req = makeRequest()
    expect(getAuthUser(req)).toBeNull()
  })

  it("getAuthUser returns user from headers", () => {
    const req = makeRequest({ "x-user-id": "42", "x-user-role": "DOCTOR" })
    const user = getAuthUser(req)
    expect(user).toEqual({ id: 42, role: "DOCTOR" })
  })

  it("requireAuth throws AuthError without headers", () => {
    const req = makeRequest()
    expect(() => requireAuth(req)).toThrow(AuthError)
  })

  it("requireRole throws AuthError for insufficient role", () => {
    const req = makeRequest({ "x-user-id": "1", "x-user-role": "VIEWER" })
    expect(() => requireRole(req, "ADMIN")).toThrow(AuthError)
  })

  it("requireRole passes for sufficient role", () => {
    const req = makeRequest({ "x-user-id": "1", "x-user-role": "ADMIN" })
    const user = requireRole(req, "DOCTOR")
    expect(user.role).toBe("ADMIN")
  })
})

// =========================================================================
// Glucose Conversions
// =========================================================================
describe("Glucose Conversions", () => {
  let convertGlucoseFromGl: typeof import("@/lib/conversions").convertGlucoseFromGl
  let convertGlucoseToGl: typeof import("@/lib/conversions").convertGlucoseToGl

  beforeEach(async () => {
    const mod = await import("@/lib/conversions")
    convertGlucoseFromGl = mod.convertGlucoseFromGl
    convertGlucoseToGl = mod.convertGlucoseToGl
  })

  it("g/L → mg/dL conversion", () => {
    expect(convertGlucoseFromGl(1.0, "mg/dL")).toBe(100)
    expect(convertGlucoseFromGl(1.2, "mg/dL")).toBeCloseTo(120)
  })

  it("mg/dL → g/L conversion", () => {
    expect(convertGlucoseToGl(100, "mg/dL")).toBe(1.0)
    expect(convertGlucoseToGl(120, "mg/dL")).toBeCloseTo(1.2)
  })

  it("g/L → mmol/L conversion", () => {
    expect(convertGlucoseFromGl(1.0, "mmol/L")).toBeCloseTo(55.5)
  })

  it("g/L identity", () => {
    expect(convertGlucoseFromGl(1.5, "g/L")).toBe(1.5)
    expect(convertGlucoseToGl(1.5, "g/L")).toBe(1.5)
  })

  it("roundtrip mg/dL", () => {
    const original = 1.19
    const mgdl = convertGlucoseFromGl(original, "mg/dL")
    const back = convertGlucoseToGl(mgdl, "mg/dL")
    expect(back).toBeCloseTo(original)
  })
})
