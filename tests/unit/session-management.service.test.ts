/**
 * @description Groupe 9 — US-2007 Session management unit tests.
 *
 * Couvre :
 *   - listOwn : isCurrent flag, filtre expires gt now, audit
 *   - revokeOne : self-only via WHERE userId, revokeSession Redis
 *   - revokeOthers : delete WHERE id != currentSessionId, audit count
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

vi.mock("@/lib/auth/revocation", () => ({
  revokeSession: vi.fn().mockResolvedValue(undefined),
  isSessionRevoked: vi.fn().mockResolvedValue(false),
}))

import {
  sessionManagementService,
  SessionNotFoundError,
} from "@/lib/services/session-management.service"

const baseSession = {
  id: "sess-1",
  sessionToken: "token-abc",
  userId: 42,
  expires: new Date(Date.now() + 3600_000),
  mfaVerified: true,
  createdAt: new Date(Date.now() - 60_000),
  ipAddress: "1.2.3.4",
  userAgent: "Chrome",
  lastSeenAt: new Date(),
}

beforeEach(() => {
  prismaMock.auditLog.create.mockResolvedValue({} as any)
})

describe("listOwn", () => {
  it("returns sessions with isCurrent flag", async () => {
    prismaMock.session.findMany.mockResolvedValue([
      baseSession,
      { ...baseSession, id: "sess-2", ipAddress: "5.6.7.8" },
    ] as any)
    const out = await sessionManagementService.listOwn(42, "sess-1")
    expect(out).toHaveLength(2)
    expect(out[0]!.isCurrent).toBe(true)
    expect(out[1]!.isCurrent).toBe(false)
  })

  it("filters expired sessions at DB layer", async () => {
    prismaMock.session.findMany.mockResolvedValue([] as any)
    await sessionManagementService.listOwn(42, "sess-1")
    const call = prismaMock.session.findMany.mock.calls[0]![0]!
    expect((call.where as any).expires).toEqual({ gt: expect.any(Date) })
    expect((call.where as any).userId).toBe(42)
  })

  it("audit metadata.kind=session.list + count", async () => {
    prismaMock.session.findMany.mockResolvedValue([baseSession, baseSession] as any)
    await sessionManagementService.listOwn(42, "sess-1")
    const meta = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(meta.metadata.kind).toBe("session.list")
    expect(meta.metadata.count).toBe(2)
  })
})

describe("revokeOne", () => {
  it("revokes own session + audit wasCurrent=true", async () => {
    prismaMock.session.findFirst.mockResolvedValue({ id: "sess-1" } as any)
    prismaMock.session.delete.mockResolvedValue({} as any)
    const out = await sessionManagementService.revokeOne(42, "sess-1", "sess-1")
    expect(out).toEqual({ revoked: true, wasCurrent: true })
    const meta = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(meta.metadata.kind).toBe("session.revoke.one")
    expect(meta.metadata.wasCurrent).toBe(true)
  })

  it("revokes a different session, wasCurrent=false", async () => {
    prismaMock.session.findFirst.mockResolvedValue({ id: "sess-2" } as any)
    prismaMock.session.delete.mockResolvedValue({} as any)
    const out = await sessionManagementService.revokeOne(42, "sess-2", "sess-1")
    expect(out.wasCurrent).toBe(false)
  })

  it("throws NotFound when session doesn't belong to user (anti-énumération)", async () => {
    prismaMock.session.findFirst.mockResolvedValue(null)
    prismaMock.session.findUnique.mockResolvedValue(null) // session inexistante
    await expect(sessionManagementService.revokeOne(42, "sess-99", "sess-1"))
      .rejects.toBeInstanceOf(SessionNotFoundError)
    // delete NE doit PAS être appelé.
    expect(prismaMock.session.delete).not.toHaveBeenCalled()
  })

  // NEW-H4 (review re-1 PR #409) — session existe mais appartient
  // à un autre user → 404 status code mais audit accessDenied row.
  it("NEW-H4 — audit accessDenied émis si session appartient à un autre user", async () => {
    prismaMock.session.findFirst.mockResolvedValue(null) // self-scoped query miss
    prismaMock.session.findUnique.mockResolvedValue({ userId: 99 } as any) // mais existe pour user 99
    await expect(sessionManagementService.revokeOne(42, "sess-99", "sess-1"))
      .rejects.toBeInstanceOf(SessionNotFoundError)
    // Audit accessDenied émis.
    const lastAudit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(lastAudit.action).toBe("UNAUTHORIZED")
    expect(lastAudit.resourceId).toBe("sess-99")
    expect(lastAudit.metadata.reason).toBe("notOwnSession")
    expect(lastAudit.metadata.actualOwnerId).toBe(99)
  })

  it("WHERE clause inclut userId pour scoping", async () => {
    prismaMock.session.findFirst.mockResolvedValue({ id: "sess-1" } as any)
    prismaMock.session.delete.mockResolvedValue({} as any)
    await sessionManagementService.revokeOne(42, "sess-1", "sess-1")
    const call = prismaMock.session.findFirst.mock.calls[0]![0]!
    expect((call.where as any).id).toBe("sess-1")
    expect((call.where as any).userId).toBe(42)
  })
})

describe("revokeOthers", () => {
  it("deletes all sessions except current + audit count", async () => {
    prismaMock.session.findMany.mockResolvedValue([
      { id: "sess-2" }, { id: "sess-3" },
    ] as any)
    prismaMock.session.deleteMany.mockResolvedValue({ count: 2 } as any)
    const out = await sessionManagementService.revokeOthers(42, "sess-1")
    expect(out).toEqual({ revoked: 2 })
    const deleteCall = prismaMock.session.deleteMany.mock.calls[0]![0]!
    expect((deleteCall.where as any).userId).toBe(42)
    expect((deleteCall.where as any).id).toEqual({ not: "sess-1" })
    const meta = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(meta.metadata.kind).toBe("session.revoke.others")
    expect(meta.metadata.revoked).toBe(2)
    expect(meta.metadata.currentSessionId).toBe("sess-1")
  })

  it("returns revoked=0 when only current session", async () => {
    prismaMock.session.findMany.mockResolvedValue([] as any)
    prismaMock.session.deleteMany.mockResolvedValue({ count: 0 } as any)
    const out = await sessionManagementService.revokeOthers(42, "sess-1")
    expect(out.revoked).toBe(0)
  })
})
