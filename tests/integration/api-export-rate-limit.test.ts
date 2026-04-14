/**
 * Test suite: /api/account/export — fail-closed rate limiting + dual bucket
 *
 * Clinical behavior tested:
 * - An RGPD export exfiltrates the user's full health dataset (Art. 20).
 *   When the rate-limit backend (Redis) is unreachable the endpoint MUST
 *   fail CLOSED: a 503-like 429 response, no export payload emitted. The
 *   opposite (fail-open) would make the 3/h quota unbounded during outages
 *   and is disallowed by the HDS threat model.
 * - The user bucket is checked BEFORE the IP bucket: a sustained burst from
 *   one user must not burn the IP quota shared by other legitimate users
 *   behind the same NAT, and a user already blocked must not incidentally
 *   consume their own IP quota.
 * - When Redis is available and the IP bucket is exhausted while the user
 *   bucket still has budget, the endpoint returns 429 with
 *   `metadata.bucket: "ip"` in the audit log (HDS traceability).
 *
 * Associated risks:
 * - A fail-open Redis outage on this endpoint would amplify any stolen-token
 *   incident into a bulk PII exfiltration
 * - A dual-bucket that increments both counters in parallel (Promise.all)
 *   would lock out legitimate users whose IP happens to be noisy
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://fake.upstash.io")
vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "fake-token")

vi.mock("@/lib/db/client", () => ({ prisma: {} }))

const evalMock = vi.fn()
vi.mock("@upstash/redis", () => ({
  Redis: class {
    eval = evalMock
  },
}))

const exportMock = vi.fn().mockResolvedValue({ profile: { id: 1 } })
vi.mock("@/lib/services/export.service", () => ({
  generateUserExport: (...args: unknown[]) => exportMock(...args),
}))

const auditLogMock = vi.fn().mockResolvedValue({})
vi.mock("@/lib/services/audit.service", () => ({
  auditService: { log: auditLogMock },
  extractRequestContext: () => ({ ipAddress: "1.2.3.4", userAgent: "vitest" }),
}))

const { GET } = await import("@/app/api/account/export/route")

function req(): NextRequest {
  return new NextRequest(new URL("http://localhost:3000/api/account/export"), {
    method: "GET",
    headers: { "x-user-id": "42", "x-user-role": "VIEWER", "user-agent": "vitest" },
  })
}

describe("/api/account/export — rate limiting", () => {
  beforeEach(() => {
    evalMock.mockReset()
    auditLogMock.mockClear()
    exportMock.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("fails CLOSED with 429 when Redis errors (user bucket is fail-closed)", async () => {
    evalMock.mockRejectedValue(new Error("UPSTASH_CONNECTION_ERROR"))

    const res = await GET(req())

    expect(res.status).toBe(429)
    expect(res.headers.get("Retry-After")).toMatch(/^\d+$/)
    expect(res.headers.get("X-RateLimit-Limit")).toMatch(/^\d+$/)
    expect(exportMock).not.toHaveBeenCalled()
  })

  it("suppresses the audit write when the block is degraded (Redis down)", async () => {
    evalMock.mockRejectedValue(new Error("UPSTASH_CONNECTION_ERROR"))

    await GET(req())

    // No DB write during Redis outage — avoids compounding into a Postgres storm
    expect(auditLogMock).not.toHaveBeenCalled()
  })

  it("short-circuits on user-bucket block: IP bucket is NOT consumed", async () => {
    // First eval call = user bucket, returns count > max (blocked)
    // No second call must reach the IP bucket.
    evalMock.mockResolvedValueOnce([4, 3600]) // count=4, ttl=3600 — over max=3

    const res = await GET(req())

    expect(res.status).toBe(429)
    expect(evalMock).toHaveBeenCalledTimes(1) // critical: no second call on IP
    expect(auditLogMock).toHaveBeenCalledTimes(1)
    const entry = auditLogMock.mock.calls[0][0]
    expect(entry.action).toBe("RATE_LIMITED")
    expect(entry.metadata.bucket).toBe("user")
  })

  it("returns 429 with bucket=ip when user passes but IP is blocked", async () => {
    evalMock
      .mockResolvedValueOnce([1, 3600])  // user bucket ok
      .mockResolvedValueOnce([11, 3600]) // ip bucket blocked (over max=10)

    const res = await GET(req())

    expect(res.status).toBe(429)
    expect(evalMock).toHaveBeenCalledTimes(2)
    const entry = auditLogMock.mock.calls[0][0]
    expect(entry.metadata.bucket).toBe("ip")
    expect(exportMock).not.toHaveBeenCalled()
  })

  it("lets the export through when both buckets are below max", async () => {
    evalMock
      .mockResolvedValueOnce([1, 3600])
      .mockResolvedValueOnce([1, 3600])

    const res = await GET(req())

    expect(res.status).toBe(200)
    expect(exportMock).toHaveBeenCalledTimes(1)
    // Export audit entry (action EXPORT), not RATE_LIMITED
    const entry = auditLogMock.mock.calls[0][0]
    expect(entry.action).toBe("EXPORT")
  })
})
