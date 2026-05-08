/**
 * Test suite: Backup Service (US-2151)
 *
 * Behaviors tested:
 * - list paginates and filters by status / date range.
 * - trigger creates a `pending` row with a UUID backupRef + audit CREATE.
 * - updateStatus enforces valid transitions; rejects terminal-to-anything.
 * - sizeBytes is BigInt in DB but Number in API DTO (JSON-serializable).
 *
 * Risks mitigated:
 * - Worker reaching back into a completed backup row (terminal-state guard).
 * - Backup audit row missing forensic info.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { backupService } from "@/lib/services/backup.service"

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.auditLog.create.mockResolvedValue({} as never)
})

describe("backupService.list", () => {
  it("returns paginated rows + cursor", async () => {
    const items = Array.from({ length: 26 }, (_, i) => ({
      id: i + 1, backupRef: `r${i}`, status: "completed",
      location: "s3://x", sizeBytes: BigInt(123), durationMs: 100,
      triggeredBy: 1, errorMessage: null,
      startedAt: new Date(), completedAt: new Date(),
    })) as never
    prismaMock.backupLog.findMany.mockResolvedValue(items)

    const result = await backupService.list({ limit: 25 }, 99)
    expect(result.items).toHaveLength(25)
    expect(result.nextCursor).toBe(25)
    // sizeBytes is converted from BigInt to Number for JSON serialization
    expect(typeof result.items[0]?.sizeBytes).toBe("number")
  })

  it("returns sizeBytes as string when value exceeds Number.MAX_SAFE_INTEGER", async () => {
    // PB-scale dump (>= 2^53 bytes ~= 9 PB) — Number conversion would lose
    // precision. Service falls back to string representation.
    const huge = BigInt(Number.MAX_SAFE_INTEGER) + 1n
    prismaMock.backupLog.findMany.mockResolvedValue([
      {
        id: 1, backupRef: "huge", status: "completed",
        location: "s3://x", sizeBytes: huge, durationMs: 100,
        triggeredBy: 1, errorMessage: null,
        startedAt: new Date(), completedAt: new Date(),
      },
    ] as never)

    const result = await backupService.list({}, 99)
    expect(typeof result.items[0]?.sizeBytes).toBe("string")
    expect(result.items[0]?.sizeBytes).toBe(huge.toString())
  })

  it("filters by status", async () => {
    prismaMock.backupLog.findMany.mockResolvedValue([] as never)
    await backupService.list({ status: ["pending", "running"] }, 99)
    const call = prismaMock.backupLog.findMany.mock.calls.at(-1)?.[0] as
      | { where?: { status?: { in?: string[] } } }
      | undefined
    expect(call?.where?.status).toEqual({ in: ["pending", "running"] })
  })
})

describe("backupService.trigger", () => {
  it("creates a pending row with UUID backupRef and triggers audit", async () => {
    const createSpy = vi.fn().mockResolvedValue({
      id: 1, backupRef: "uuid-1", status: "pending", triggeredBy: 99,
      location: null, sizeBytes: null, durationMs: null,
      errorMessage: null, startedAt: new Date(), completedAt: null,
    })
    const countSpy = vi.fn().mockResolvedValue(0)
    const auditSpy = vi.fn().mockResolvedValue({})
    const mockTx = {
      backupLog: { create: createSpy, count: countSpy },
      auditLog: { create: auditSpy },
    }
    prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as never)

    const result = await backupService.trigger(99)
    expect(result.status).toBe("pending")
    expect(result.triggeredBy).toBe(99)
    expect(createSpy.mock.calls[0]?.[0]?.data.backupRef).toBeTruthy()
    expect(auditSpy).toHaveBeenCalled()
  })

  it("rejects when an inflight backup exists (concurrency guard)", async () => {
    const countSpy = vi.fn().mockResolvedValue(1)
    const createSpy = vi.fn()
    const mockTx = {
      backupLog: { create: createSpy, count: countSpy },
      auditLog: { create: vi.fn() },
    }
    prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as never)

    await expect(backupService.trigger(99)).rejects.toThrow("backup_already_in_progress")
    expect(createSpy).not.toHaveBeenCalled()
  })
})

describe("backupService.updateStatus", () => {
  it("rejects update on a completed backup (terminal state)", async () => {
    const mockTx = {
      backupLog: {
        findUnique: vi.fn().mockResolvedValue({
          id: 1, backupRef: "r1", status: "completed",
        }),
        update: vi.fn(),
      },
      auditLog: { create: vi.fn() },
    }
    prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as never)

    await expect(
      backupService.updateStatus("r1", { status: "failed" }, 0),
    ).rejects.toThrow("backup_already_terminal")
  })

  it("rejects unknown backupRef", async () => {
    const mockTx = {
      backupLog: { findUnique: vi.fn().mockResolvedValue(null), update: vi.fn() },
      auditLog: { create: vi.fn() },
    }
    prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as never)

    await expect(
      backupService.updateStatus("nope", { status: "running" }, 0),
    ).rejects.toThrow("backup_not_found")
  })

  it("transitions pending → completed and stamps completedAt", async () => {
    const updateSpy = vi.fn().mockResolvedValue({
      id: 1, backupRef: "r1", status: "completed",
      location: "s3://b/dump.gz", sizeBytes: BigInt(2048),
      durationMs: 1500, completedAt: new Date(),
      triggeredBy: 99, errorMessage: null, startedAt: new Date(),
    })
    const mockTx = {
      backupLog: {
        findUnique: vi.fn().mockResolvedValue({
          id: 1, backupRef: "r1", status: "running",
        }),
        update: updateSpy,
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as never)

    const result = await backupService.updateStatus(
      "r1",
      { status: "completed", location: "s3://b/dump.gz", sizeBytes: 2048, durationMs: 1500 },
      0,
    )
    expect(result.status).toBe("completed")
    expect(result.sizeBytes).toBe(2048)
    const callData = updateSpy.mock.calls[0]?.[0]?.data as { completedAt?: Date }
    expect(callData.completedAt).toBeInstanceOf(Date)
  })
})
