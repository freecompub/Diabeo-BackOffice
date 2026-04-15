/**
 * Test suite: GET /api/health
 *
 * Clinical / operational behavior tested:
 * - Returns HTTP 200 + `status: "ok"` when DB and Redis probes both succeed
 *   (OVH monitoring treats non-200 as an alert; 200 is the "all clear" signal).
 * - Returns HTTP 503 + `status: "degraded"` when Redis is down but DB is up —
 *   the app continues serving (rate-limit falls back to memory, session
 *   revocation fails closed per HDS policy) but the operator is paged.
 * - Returns HTTP 503 + `status: "down"` when the DB probe fails — nothing
 *   works, all endpoints would 500, health reflects that honestly.
 * - Endpoint is PUBLIC: no JWT required (middleware skips /api/health).
 *
 * Associated risks:
 * - A health endpoint that returns 200 when Redis is dead would hide a
 *   degraded state from OVH Cloud Monitoring → silent outage.
 * - A health endpoint that requires a JWT would be unreachable during an
 *   outage that breaks auth → blind monitoring.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.stubEnv("UPSTASH_REDIS_REST_URL", "")
vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "")

const dbProbeMock = vi.fn()
vi.mock("@/lib/db/client", () => ({
  prisma: {
    $queryRaw: (...a: unknown[]) => dbProbeMock(...a),
  },
}))

const cacheGetMock = vi.fn()
vi.mock("@/lib/cache/redis-cache", () => ({
  cacheGet: (...a: unknown[]) => cacheGetMock(...a),
}))

const { GET } = await import("@/app/api/health/route")

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 200 + status=ok when DB and Redis are both up", async () => {
    dbProbeMock.mockResolvedValue([{ "?column?": 1 }])
    cacheGetMock.mockResolvedValue(undefined)

    const res = await GET()

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe("ok")
    expect(body.db).toBe("ok")
    expect(body.redis).toBe("ok")
    expect(typeof body.version).toBe("string")
  })

  it("returns 503 + status=degraded when Redis is down but DB is up", async () => {
    dbProbeMock.mockResolvedValue([{ "?column?": 1 }])
    cacheGetMock.mockRejectedValue(new Error("UPSTASH_CONNECTION_ERROR"))

    const res = await GET()

    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.status).toBe("degraded")
    expect(body.db).toBe("ok")
    expect(body.redis).toBe("down")
  })

  it("returns 503 + status=down when the DB probe fails", async () => {
    dbProbeMock.mockRejectedValue(new Error("connection refused"))
    cacheGetMock.mockResolvedValue(undefined)

    const res = await GET()

    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.status).toBe("down")
    expect(body.db).toBe("down")
  })

  it("treats a stalled probe (>1 s) as down, not hung", async () => {
    // A DB that never replies would otherwise block the health endpoint
    // forever, defeating its purpose. We race against a 1 s timeout.
    dbProbeMock.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve([{ "?column?": 1 }]), 5000)),
    )
    cacheGetMock.mockResolvedValue(undefined)

    const res = await GET()

    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.db).toBe("down")
  }, 3000)

  it("returns a stable JSON shape (contract test for monitoring)", async () => {
    dbProbeMock.mockResolvedValue([{ "?column?": 1 }])
    cacheGetMock.mockResolvedValue(undefined)

    const body = await (await GET()).json()
    // Monitoring alert rules depend on these exact key names; guard rename.
    expect(Object.keys(body).sort()).toEqual(["db", "redis", "status", "version"])
  })
})
