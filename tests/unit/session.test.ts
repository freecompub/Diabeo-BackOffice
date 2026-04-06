/**
 * Tests for session management (src/lib/auth/session.ts).
 *
 * Clinical safety context: session lifecycle is critical for HDS compliance.
 * invalidateAllUserSessions must revoke all sessions in Redis AND delete
 * from PostgreSQL to ensure immediate access revocation when an account
 * is disabled, a role is changed, or RGPD Art. 17 deletion is processed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

// Mock revocation module
const mockRevokeSession = vi.fn()
vi.mock("@/lib/auth/revocation", () => ({
  revokeSession: (...args: unknown[]) => mockRevokeSession(...args),
}))

const {
  createSession,
  getSession,
  invalidateSession,
  invalidateAllUserSessions,
} = await import("@/lib/auth/session")

describe("Session management", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("createSession", () => {
    it("creates a session with 24h expiry", async () => {
      const now = Date.now()
      prismaMock.session.create.mockResolvedValue({
        id: "session-1",
        sessionToken: "token-hex",
        userId: 42,
        expires: new Date(now + 24 * 3600_000),
      } as any)

      const result = await createSession(42)

      expect(prismaMock.session.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 42,
          sessionToken: expect.any(String),
          expires: expect.any(Date),
        }),
      })
      expect(result.userId).toBe(42)
    })
  })

  describe("getSession", () => {
    it("returns session when valid and not expired", async () => {
      const future = new Date(Date.now() + 3600_000)
      prismaMock.session.findUnique.mockResolvedValue({
        id: "sid-1",
        sessionToken: "tok",
        userId: 1,
        expires: future,
      } as any)

      const result = await getSession("sid-1")

      expect(result).not.toBeNull()
      expect(result!.id).toBe("sid-1")
    })

    it("returns null when session not found", async () => {
      prismaMock.session.findUnique.mockResolvedValue(null)

      const result = await getSession("nonexistent")

      expect(result).toBeNull()
    })

    it("returns null when session is expired", async () => {
      const past = new Date(Date.now() - 3600_000)
      prismaMock.session.findUnique.mockResolvedValue({
        id: "sid-expired",
        sessionToken: "tok",
        userId: 1,
        expires: past,
      } as any)

      const result = await getSession("sid-expired")

      expect(result).toBeNull()
    })
  })

  describe("invalidateSession", () => {
    it("deletes session from database", async () => {
      prismaMock.session.delete.mockResolvedValue({} as any)

      await invalidateSession("sid-to-delete")

      expect(prismaMock.session.delete).toHaveBeenCalledWith({
        where: { id: "sid-to-delete" },
      })
    })

    it("returns null silently when session does not exist", async () => {
      prismaMock.session.delete.mockRejectedValue(new Error("Not found"))

      const result = await invalidateSession("nonexistent")

      expect(result).toBeNull()
    })
  })

  describe("invalidateAllUserSessions", () => {
    it("revokes each session in Redis before deleting from DB", async () => {
      prismaMock.session.findMany.mockResolvedValue([
        { id: "sid-1" },
        { id: "sid-2" },
        { id: "sid-3" },
      ] as any)
      prismaMock.session.deleteMany.mockResolvedValue({ count: 3 })
      mockRevokeSession.mockResolvedValue(true)

      await invalidateAllUserSessions(42)

      // Each session must be revoked in Redis
      expect(mockRevokeSession).toHaveBeenCalledTimes(3)
      expect(mockRevokeSession).toHaveBeenCalledWith("sid-1")
      expect(mockRevokeSession).toHaveBeenCalledWith("sid-2")
      expect(mockRevokeSession).toHaveBeenCalledWith("sid-3")

      // Then all sessions deleted from DB
      expect(prismaMock.session.deleteMany).toHaveBeenCalledWith({
        where: { userId: 42 },
      })
    })

    it("handles user with zero sessions gracefully", async () => {
      prismaMock.session.findMany.mockResolvedValue([])
      prismaMock.session.deleteMany.mockResolvedValue({ count: 0 })

      await invalidateAllUserSessions(99)

      expect(mockRevokeSession).not.toHaveBeenCalled()
      expect(prismaMock.session.deleteMany).toHaveBeenCalledWith({
        where: { userId: 99 },
      })
    })

    it("still deletes from DB even if one Redis revocation fails", async () => {
      prismaMock.session.findMany.mockResolvedValue([
        { id: "sid-ok" },
        { id: "sid-fail" },
      ] as any)
      prismaMock.session.deleteMany.mockResolvedValue({ count: 2 })
      mockRevokeSession
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)

      await invalidateAllUserSessions(42)

      expect(mockRevokeSession).toHaveBeenCalledTimes(2)
      expect(prismaMock.session.deleteMany).toHaveBeenCalled()
    })
  })
})
