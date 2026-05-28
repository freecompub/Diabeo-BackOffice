/**
 * Tests pour `src/lib/services/audit-coalescing.service.ts` (Plan B
 * follow-up A3).
 *
 * Couvre :
 *   - enqueueCoalesced : accumulation buffer, key dedup
 *   - flush : 1 INSERT par entry, metadata.coalesced.{count,firstAt,lastAt}
 *   - buffer cap trigger force flush
 *   - first metadata wins (subsequent metadata ignored)
 *   - flush vide le buffer atomiquement avant INSERTs
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"
import {
  enqueueCoalesced,
  flush,
  __resetCoalescingForTests,
  __getBufferSnapshotForTests,
  COALESCING_CONFIG,
} from "@/lib/services/audit-coalescing.service"

beforeEach(() => {
  vi.clearAllMocks()
  __resetCoalescingForTests()
  prismaMock.auditLog.create.mockResolvedValue({} as never)
})

afterEach(() => {
  __resetCoalescingForTests()
})

describe("enqueueCoalesced — accumulation", () => {
  it("1 event → 1 entry dans buffer", async () => {
    await enqueueCoalesced({
      userId: 1,
      action: "READ",
      resource: "PATIENT",
      resourceId: "search",
    })
    const snap = __getBufferSnapshotForTests()
    expect(snap.size).toBe(1)
    expect(snap.keys[0]).toBe("1:READ:PATIENT:search")
  })

  it("3 events même tuple → 1 entry (count incrémenté au flush)", async () => {
    for (let i = 0; i < 3; i++) {
      await enqueueCoalesced({
        userId: 1,
        action: "READ",
        resource: "PATIENT",
        resourceId: "search",
      })
    }
    expect(__getBufferSnapshotForTests().size).toBe(1)
  })

  it("2 users différents → 2 entries distinctes", async () => {
    await enqueueCoalesced({
      userId: 1, action: "READ", resource: "PATIENT", resourceId: "search",
    })
    await enqueueCoalesced({
      userId: 2, action: "READ", resource: "PATIENT", resourceId: "search",
    })
    expect(__getBufferSnapshotForTests().size).toBe(2)
  })

  it("anon user (userId=null) → key 'anon'", async () => {
    await enqueueCoalesced({
      userId: null, action: "READ", resource: "PATIENT", resourceId: "search",
    })
    expect(__getBufferSnapshotForTests().keys[0]).toBe("anon:READ:PATIENT:search")
  })
})

describe("flush — INSERT semantics", () => {
  it("buffer vide → no-op (0 INSERTs)", async () => {
    const result = await flush()
    expect(result).toEqual({ flushed: 0, failed: 0 })
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled()
  })

  it("3 events même tuple → 1 INSERT avec metadata.coalesced.count=3", async () => {
    for (let i = 0; i < 3; i++) {
      await enqueueCoalesced({
        userId: 1, action: "READ", resource: "PATIENT", resourceId: "search",
        metadata: { count: i },
      })
    }
    const result = await flush()
    expect(result.flushed).toBe(1)
    expect(prismaMock.auditLog.create).toHaveBeenCalledOnce()
    const inserted = vi.mocked(prismaMock.auditLog.create).mock.calls[0]?.[0]
    expect(inserted?.data).toMatchObject({
      userId: 1, action: "READ", resource: "PATIENT", resourceId: "search",
    })
    expect((inserted?.data?.metadata as Record<string, unknown>)?.coalesced).toMatchObject({
      count: 3,
    })
  })

  it("metadata 1ère wins — subsequent metadata ignorées dans la même fenêtre", async () => {
    await enqueueCoalesced({
      userId: 1, action: "READ", resource: "PATIENT", resourceId: "search",
      metadata: { hasSearch: true, count: 10 },
    })
    await enqueueCoalesced({
      userId: 1, action: "READ", resource: "PATIENT", resourceId: "search",
      metadata: { hasSearch: false, count: 999 },
    })
    await flush()
    const inserted = vi.mocked(prismaMock.auditLog.create).mock.calls[0]?.[0]
    const meta = inserted?.data?.metadata as Record<string, unknown>
    expect(meta.hasSearch).toBe(true) // 1ère valeur préservée
    expect(meta.count).toBe(10) // 1ère valeur préservée
    expect((meta.coalesced as Record<string, unknown>).count).toBe(2)
  })

  it("2 entries distinctes → 2 INSERTs Promise.all", async () => {
    await enqueueCoalesced({
      userId: 1, action: "READ", resource: "PATIENT", resourceId: "search",
    })
    await enqueueCoalesced({
      userId: 2, action: "READ", resource: "PATIENT", resourceId: "search",
    })
    const result = await flush()
    expect(result.flushed).toBe(2)
    expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(2)
  })

  it("flush vide le buffer (snapshot+clear atomique avant INSERTs)", async () => {
    await enqueueCoalesced({
      userId: 1, action: "READ", resource: "PATIENT", resourceId: "search",
    })
    expect(__getBufferSnapshotForTests().size).toBe(1)
    await flush()
    expect(__getBufferSnapshotForTests().size).toBe(0)
  })

  it("INSERT fail → log warn, continue, failed count incrémenté", async () => {
    await enqueueCoalesced({
      userId: 1, action: "READ", resource: "PATIENT", resourceId: "search",
    })
    await enqueueCoalesced({
      userId: 2, action: "READ", resource: "PATIENT", resourceId: "search",
    })
    prismaMock.auditLog.create
      .mockRejectedValueOnce(new Error("DB down"))
      .mockResolvedValueOnce({} as never)
    const result = await flush()
    expect(result.flushed).toBe(2)
    expect(result.failed).toBe(1)
  })

  it("firstAt < lastAt — ordering préservé", async () => {
    const t0 = Date.now()
    vi.setSystemTime(t0)
    await enqueueCoalesced({
      userId: 1, action: "READ", resource: "PATIENT", resourceId: "search",
    })
    vi.setSystemTime(t0 + 5000)
    await enqueueCoalesced({
      userId: 1, action: "READ", resource: "PATIENT", resourceId: "search",
    })
    await flush()
    vi.useRealTimers()
    const meta = (vi.mocked(prismaMock.auditLog.create).mock.calls[0]?.[0]?.data?.metadata as Record<string, unknown>)
    const coalesced = meta.coalesced as Record<string, string>
    expect(new Date(coalesced.firstAt).getTime()).toBe(t0)
    expect(new Date(coalesced.lastAt).getTime()).toBe(t0 + 5000)
  })
})

describe("__resetCoalescingForTests guard", () => {
  it("throw si NODE_ENV/VITEST pas set", () => {
    const originalNode = process.env.NODE_ENV
    const originalVitest = process.env.VITEST
    try {
      // @ts-expect-error override
      process.env.NODE_ENV = "production"
      delete process.env.VITEST
      expect(() => __resetCoalescingForTests()).toThrow(/test-only/)
    } finally {
      // @ts-expect-error restore
      process.env.NODE_ENV = originalNode
      if (originalVitest !== undefined) process.env.VITEST = originalVitest
    }
  })
})

describe("COALESCING_CONFIG", () => {
  it("expose flush interval + cap pour adoption", () => {
    expect(COALESCING_CONFIG.FLUSH_INTERVAL_MS).toBe(30_000)
    expect(COALESCING_CONFIG.MAX_BUFFER_SIZE).toBe(10_000)
  })
})
