/**
 * Tests for session revocation via Upstash Redis.
 *
 * Clinical safety context: session revocation is critical for HDS compliance.
 * A logged-out user must not retain access to patient health data.
 * These tests verify that the revocation store correctly marks and detects
 * revoked sessions across runtimes (Edge middleware + Node.js API routes).
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

// Dynamic import to pick up mocked env vars
const { revokeSession, isSessionRevoked } = await import(
  "@/lib/auth/revocation"
)

describe("Session revocation (Upstash Redis)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("revokeSession", () => {
    it("writes session ID to Redis with TTL", async () => {
      mockSet.mockResolvedValue("OK")

      await revokeSession("session-123", 3600)

      expect(mockSet).toHaveBeenCalledWith("revoked:session-123", "1", {
        ex: 3600,
      })
    })

    it("uses default 24h TTL when not specified", async () => {
      mockSet.mockResolvedValue("OK")

      await revokeSession("session-456")

      expect(mockSet).toHaveBeenCalledWith("revoked:session-456", "1", {
        ex: 86400,
      })
    })

    it("clamps negative TTL to 1 second", async () => {
      mockSet.mockResolvedValue("OK")

      await revokeSession("expired-session", -100)

      expect(mockSet).toHaveBeenCalledWith("revoked:expired-session", "1", {
        ex: 1,
      })
    })
  })

  describe("isSessionRevoked", () => {
    it("returns true when session is revoked", async () => {
      mockGet.mockResolvedValue("1")

      const result = await isSessionRevoked("revoked-sid")

      expect(result).toBe(true)
      expect(mockGet).toHaveBeenCalledWith("revoked:revoked-sid")
    })

    it("returns false when session is not revoked", async () => {
      mockGet.mockResolvedValue(null)

      const result = await isSessionRevoked("valid-sid")

      expect(result).toBe(false)
    })

    it("returns false (fail-open) when Redis throws", async () => {
      mockGet.mockRejectedValue(new Error("Connection refused"))

      const result = await isSessionRevoked("any-sid")

      expect(result).toBe(false)
    })
  })
})
