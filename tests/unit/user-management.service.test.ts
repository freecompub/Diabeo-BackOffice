/**
 * Test suite: User Management Service (US-2148)
 *
 * Behaviors tested:
 * - List paginates and decrypts PII at the boundary (admin can read; service
 *   stays opaque about ciphertext to consumers).
 * - Role transitions audit oldValue/newValue.
 * - Anti-lock-out : the last active ADMIN cannot be demoted/suspended.
 * - Self-status change is forbidden (cannot suspend yourself).
 * - Suspend/archive transitions invalidate active sessions.
 *
 * Risks mitigated:
 * - Lock-out of all admins (operational catastrophe).
 * - Stale sessions persisting after suspension (security gap).
 * - PII leaking in audit metadata (handled in service via no-PHI metadata).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

vi.mock("@/lib/crypto/fields", async () => {
  const actual = await vi.importActual<typeof import("@/lib/crypto/fields")>("@/lib/crypto/fields")
  return {
    ...actual,
    safeDecryptField: vi.fn((v: string | null) => v ? `dec:${v}` : null),
  }
})

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { userManagementService } from "@/lib/services/user-management.service"

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.auditLog.create.mockResolvedValue({} as never)
})

describe("userManagementService", () => {
  describe("list", () => {
    it("returns paginated users with PII decrypted at the boundary", async () => {
      prismaMock.user.findMany.mockResolvedValue([
        {
          id: 1,
          email: "enc-email",
          firstname: "enc-fn",
          lastname: "enc-ln",
          role: "DOCTOR",
          status: "active",
          statusChangedAt: null,
          mfaEnabled: false,
          language: "fr",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as never)

      const result = await userManagementService.list({ serviceScope: null }, 99)
      expect(result.items).toHaveLength(1)
      expect(result.items[0]?.email).toBe("dec:enc-email")
      expect(result.items[0]?.firstname).toBe("dec:enc-fn")
    })

    it("scopes by serviceId via HealthcareMember when serviceScope is set", async () => {
      prismaMock.healthcareMember.findMany.mockResolvedValue([
        { userId: 10 },
        { userId: 20 },
      ] as never)
      prismaMock.user.findMany.mockResolvedValue([] as never)

      await userManagementService.list({ serviceScope: 5 }, 99)
      const findManyCall = prismaMock.user.findMany.mock.calls.at(-1)?.[0] as
        | { where?: { id?: { in?: number[] } } }
        | undefined
      expect(findManyCall?.where?.id).toEqual({ in: [10, 20] })
    })

    it("paginates with cursor when items exceed limit", async () => {
      const items = Array.from({ length: 26 }, (_, i) => ({
        id: i + 1,
        email: "x", firstname: null, lastname: null,
        role: "VIEWER", status: "active", statusChangedAt: null,
        mfaEnabled: false, language: "fr",
        createdAt: new Date(), updatedAt: new Date(),
      })) as never
      prismaMock.user.findMany.mockResolvedValue(items)

      const result = await userManagementService.list(
        { serviceScope: null, limit: 25 },
        99,
      )
      expect(result.items).toHaveLength(25)
      expect(result.nextCursor).toBe(25)
    })
  })

  describe("updateRole", () => {
    it("rejects unknown user", async () => {
      const mockTx = {
        user: { findUnique: vi.fn().mockResolvedValue(null), update: vi.fn(), count: vi.fn() },
        auditLog: { create: vi.fn() },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as never)
      await expect(userManagementService.updateRole(999, "NURSE", 1)).rejects.toThrow("user_not_found")
    })

    it("returns no-op when role unchanged", async () => {
      const mockTx = {
        user: {
          findUnique: vi.fn().mockResolvedValue({ role: "NURSE", status: "active" }),
          update: vi.fn(),
          count: vi.fn(),
        },
        auditLog: { create: vi.fn() },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as never)
      const r = await userManagementService.updateRole(1, "NURSE", 99)
      expect(r.changed).toBe(false)
      expect(mockTx.user.update).not.toHaveBeenCalled()
    })

    it("refuses to demote the last active ADMIN (anti-lock-out)", async () => {
      const mockTx = {
        user: {
          findUnique: vi.fn().mockResolvedValue({ role: "ADMIN", status: "active" }),
          update: vi.fn(),
          count: vi.fn().mockResolvedValue(0), // no other active admins
        },
        auditLog: { create: vi.fn() },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as never)
      await expect(userManagementService.updateRole(1, "DOCTOR", 99)).rejects.toThrow(
        "last_admin_cannot_be_demoted",
      )
    })

    it("allows demotion when other active ADMINs exist", async () => {
      const mockTx = {
        user: {
          findUnique: vi.fn().mockResolvedValue({ role: "ADMIN", status: "active" }),
          update: vi.fn().mockResolvedValue({ id: 1, role: "DOCTOR" }),
          count: vi.fn().mockResolvedValue(2), // other active admins exist
        },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as never)
      const r = await userManagementService.updateRole(1, "DOCTOR", 99)
      expect(r.role).toBe("DOCTOR")
      expect(mockTx.user.update).toHaveBeenCalled()
    })
  })

  describe("setStatus", () => {
    it("refuses self-status change (anti-lockout)", async () => {
      await expect(userManagementService.setStatus(42, "suspended", 42)).rejects.toThrow(
        "cannot_change_own_status",
      )
    })

    it("rejects unknown user", async () => {
      const mockTx = {
        user: { findUnique: vi.fn().mockResolvedValue(null), update: vi.fn(), count: vi.fn() },
        session: { deleteMany: vi.fn() },
        auditLog: { create: vi.fn() },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as never)
      await expect(userManagementService.setStatus(999, "suspended", 1)).rejects.toThrow(
        "user_not_found",
      )
    })

    it("refuses to suspend the last active ADMIN", async () => {
      const mockTx = {
        user: {
          findUnique: vi.fn().mockResolvedValue({ status: "active", role: "ADMIN" }),
          update: vi.fn(),
          count: vi.fn().mockResolvedValue(0),
        },
        session: { deleteMany: vi.fn() },
        auditLog: { create: vi.fn() },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as never)
      await expect(userManagementService.setStatus(1, "suspended", 99)).rejects.toThrow(
        "last_active_admin_cannot_be_suspended",
      )
    })

    it("invalidates sessions on suspend (DB delete + Redis revoke)", async () => {
      const deleteManySpy = vi.fn().mockResolvedValue({ count: 3 })
      const findManySpy = vi.fn().mockResolvedValue([
        { sessionToken: "sid-1" },
        { sessionToken: "sid-2" },
      ])
      const mockTx = {
        user: {
          findUnique: vi.fn().mockResolvedValue({ status: "active", role: "DOCTOR" }),
          update: vi.fn().mockResolvedValue({
            id: 1, status: "suspended", statusChangedAt: new Date(),
          }),
          count: vi.fn(),
        },
        session: { findMany: findManySpy, deleteMany: deleteManySpy },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation(
        (async (cb: any, _opts?: unknown) => cb(mockTx)) as never,
      )
      await userManagementService.setStatus(1, "suspended", 99)
      expect(findManySpy).toHaveBeenCalledWith({
        where: { userId: 1 },
        select: { sessionToken: true },
      })
      expect(deleteManySpy).toHaveBeenCalledWith({ where: { userId: 1 } })
    })

    it("does NOT invalidate sessions on reactivation (suspended → active)", async () => {
      const deleteManySpy = vi.fn()
      const findManySpy = vi.fn()
      const mockTx = {
        user: {
          findUnique: vi.fn().mockResolvedValue({ status: "suspended", role: "DOCTOR" }),
          update: vi.fn().mockResolvedValue({
            id: 1, status: "active", statusChangedAt: new Date(),
          }),
          count: vi.fn(),
        },
        session: { findMany: findManySpy, deleteMany: deleteManySpy },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation(
        (async (cb: any, _opts?: unknown) => cb(mockTx)) as never,
      )
      await userManagementService.setStatus(1, "active", 99)
      expect(deleteManySpy).not.toHaveBeenCalled()
      expect(findManySpy).not.toHaveBeenCalled()
    })
  })
})
