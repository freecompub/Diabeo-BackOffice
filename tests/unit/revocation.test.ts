/**
 * Tests for session revocation via Upstash Redis.
 *
 * Clinical safety context: session revocation is critical for HDS compliance
 * (ISO 27001 A.9.4.2, ANSSI RGS v2.0). A logged-out user must not retain
 * access to patient health data. These tests verify:
 * - Revocation writes to Redis with correct key prefix and TTL
 * - Revocation check correctly detects revoked sessions
 * - Fail-closed behavior: Redis unavailability blocks requests (HDS)
 * - Graceful error handling on write failures
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock @upstash/redis before importing the module under test
const mockSet = vi.fn()
const mockGet = vi.fn()

vi.mock("@upstash/redis", () => {
  return {
    Redis: class MockRedis {
      set = mockSet
      get = mockGet
    },
  }
})

// Set env vars before importing the module
process.env.UPSTASH_REDIS_REST_URL = "https://test.upstash.io"
process.env.UPSTASH_REDIS_REST_TOKEN = "test-token"
// REDIS_KEY_PREFIX not set → defaults to "diabeo:prod:"

// Dynamic import to pick up mocked env vars
const { revokeSession, isSessionRevoked, _resetForTesting } = await import(
  "@/lib/auth/revocation"
)

describe("Session revocation (Upstash Redis)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetForTesting()
  })

  describe("revokeSession", () => {
    it("writes session ID to Redis with correct prefix and TTL", async () => {
      mockSet.mockResolvedValue("OK")

      const result = await revokeSession("session-123", 3600)

      expect(result).toBe(true)
      expect(mockSet).toHaveBeenCalledWith(
        "diabeo:prod:revoked:session-123",
        "1",
        { ex: 3600 },
      )
    })

    it("uses default 24h TTL when not specified", async () => {
      mockSet.mockResolvedValue("OK")

      const result = await revokeSession("session-456")

      expect(result).toBe(true)
      expect(mockSet).toHaveBeenCalledWith(
        "diabeo:prod:revoked:session-456",
        "1",
        { ex: 86400 },
      )
    })

    it("clamps low TTL to minimum 60 seconds (clock drift safety)", async () => {
      mockSet.mockResolvedValue("OK")

      await revokeSession("nearly-expired", 5)

      expect(mockSet).toHaveBeenCalledWith(
        "diabeo:prod:revoked:nearly-expired",
        "1",
        { ex: 60 },
      )
    })

    it("clamps negative TTL to minimum 60 seconds", async () => {
      mockSet.mockResolvedValue("OK")

      await revokeSession("expired-session", -100)

      expect(mockSet).toHaveBeenCalledWith(
        "diabeo:prod:revoked:expired-session",
        "1",
        { ex: 60 },
      )
    })

    it("returns false when Redis write fails", async () => {
      mockSet.mockRejectedValue(new Error("Write timeout"))

      const result = await revokeSession("fail-sid", 3600)

      expect(result).toBe(false)
    })

    it("returns false when Redis is not configured", async () => {
      // Temporarily remove env vars
      const savedUrl = process.env.UPSTASH_REDIS_REST_URL
      const savedToken = process.env.UPSTASH_REDIS_REST_TOKEN
      delete process.env.UPSTASH_REDIS_REST_URL
      delete process.env.UPSTASH_REDIS_REST_TOKEN
      _resetForTesting()

      const result = await revokeSession("no-redis-sid", 3600)

      expect(result).toBe(false)
      expect(mockSet).not.toHaveBeenCalled()

      // Restore env vars
      process.env.UPSTASH_REDIS_REST_URL = savedUrl
      process.env.UPSTASH_REDIS_REST_TOKEN = savedToken
    })

    it("clamps zero TTL to minimum 60 seconds", async () => {
      mockSet.mockResolvedValue("OK")

      await revokeSession("zero-ttl-sid", 0)

      expect(mockSet).toHaveBeenCalledWith(
        "diabeo:prod:revoked:zero-ttl-sid",
        "1",
        { ex: 60 },
      )
    })

    it("handles very large TTL without overflow", async () => {
      mockSet.mockResolvedValue("OK")

      const result = await revokeSession("large-ttl-sid", 999999)

      expect(result).toBe(true)
      expect(mockSet).toHaveBeenCalledWith(
        "diabeo:prod:revoked:large-ttl-sid",
        "1",
        { ex: 999999 },
      )
    })
  })

  describe("isSessionRevoked", () => {
    it("returns true when session is revoked", async () => {
      mockGet.mockResolvedValue("1")

      const result = await isSessionRevoked("revoked-sid")

      expect(result).toBe(true)
      expect(mockGet).toHaveBeenCalledWith("diabeo:prod:revoked:revoked-sid")
    })

    it("returns false when session is not revoked", async () => {
      mockGet.mockResolvedValue(null)

      const result = await isSessionRevoked("valid-sid")

      expect(result).toBe(false)
    })

    it("returns true (fail-closed) when Redis throws — HDS compliance", async () => {
      mockGet.mockRejectedValue(new Error("Connection refused"))

      const result = await isSessionRevoked("any-sid")

      // Fail-closed: treat session as revoked when Redis is unavailable
      // This prevents revoked sessions from being accepted during outages
      expect(result).toBe(true)
    })

    it("returns true for any non-null stored value (defensive)", async () => {
      mockGet.mockResolvedValue("unexpected-value")

      const result = await isSessionRevoked("any-sid")

      expect(result).toBe(true)
    })

    it("returns false when Redis is not configured (dev/test mode)", async () => {
      const savedUrl = process.env.UPSTASH_REDIS_REST_URL
      const savedToken = process.env.UPSTASH_REDIS_REST_TOKEN
      delete process.env.UPSTASH_REDIS_REST_URL
      delete process.env.UPSTASH_REDIS_REST_TOKEN
      _resetForTesting()

      const result = await isSessionRevoked("no-redis-sid")

      expect(result).toBe(false)
      expect(mockGet).not.toHaveBeenCalled()

      process.env.UPSTASH_REDIS_REST_URL = savedUrl
      process.env.UPSTASH_REDIS_REST_TOKEN = savedToken
    })
  })
})
