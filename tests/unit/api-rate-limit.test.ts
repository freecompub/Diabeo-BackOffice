/**
 * Test suite: Generic API Rate Limiter
 *
 * Clinical behavior tested:
 * - Sliding-window budget is consumed per-user, per-bucket: analytics and
 *   export endpoints enforce per-user quotas to protect PostgreSQL from
 *   DoS bursts (30 req/min for analytics, 3 req/hour for RGPD exports)
 * - Window reset: after the window elapses, the budget is replenished,
 *   preventing permanent lock-out from transient spikes
 * - Retry-After signalling: the 429 response carries a correct Retry-After
 *   hint so SPA clients can back off gracefully rather than hammer the API
 *
 * Associated risks:
 * - A stateless (per-request) limiter would provide no real protection
 * - A shared counter across users would let one noisy user lock out others
 * - A wrong Retry-After value would cause infinite retry loops from the UI
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

// Force in-memory fallback by clearing Upstash env vars before import.
vi.stubEnv("UPSTASH_REDIS_REST_URL", "")
vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "")

const { checkApiRateLimit, RATE_LIMITS } = await import("@/lib/auth/api-rate-limit")

describe("checkApiRateLimit (in-memory fallback)", () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it("allows requests within the window up to max", async () => {
    const id = `user-${Date.now()}-a`
    const cfg = { bucket: "test-a", windowSec: 60, max: 3 }

    const r1 = await checkApiRateLimit(id, cfg)
    expect(r1.allowed).toBe(true)
    expect(r1.remaining).toBe(2)

    const r2 = await checkApiRateLimit(id, cfg)
    expect(r2.allowed).toBe(true)
    expect(r2.remaining).toBe(1)

    const r3 = await checkApiRateLimit(id, cfg)
    expect(r3.allowed).toBe(true)
    expect(r3.remaining).toBe(0)
  })

  it("blocks the (max+1)th request with Retry-After", async () => {
    const id = `user-${Date.now()}-b`
    const cfg = { bucket: "test-b", windowSec: 60, max: 2 }

    await checkApiRateLimit(id, cfg)
    await checkApiRateLimit(id, cfg)
    const blocked = await checkApiRateLimit(id, cfg)

    expect(blocked.allowed).toBe(false)
    expect(blocked.remaining).toBe(0)
    expect(blocked.retryAfterSec).toBeGreaterThan(0)
    expect(blocked.retryAfterSec).toBeLessThanOrEqual(60)
  })

  it("isolates counters per identifier (no cross-user lockout)", async () => {
    const cfg = { bucket: "test-iso", windowSec: 60, max: 1 }
    const userA = `user-${Date.now()}-iso-a`
    const userB = `user-${Date.now()}-iso-b`

    const a1 = await checkApiRateLimit(userA, cfg)
    const a2 = await checkApiRateLimit(userA, cfg)
    const b1 = await checkApiRateLimit(userB, cfg)

    expect(a1.allowed).toBe(true)
    expect(a2.allowed).toBe(false)
    expect(b1.allowed).toBe(true)
  })

  it("isolates counters per bucket", async () => {
    const id = `user-${Date.now()}-buckets`
    const cfgA = { bucket: "bucket-a", windowSec: 60, max: 1 }
    const cfgB = { bucket: "bucket-b", windowSec: 60, max: 1 }

    const a = await checkApiRateLimit(id, cfgA)
    const b = await checkApiRateLimit(id, cfgB)

    expect(a.allowed).toBe(true)
    expect(b.allowed).toBe(true)
  })

  it("replenishes budget after the window expires", async () => {
    const id = `user-reset`
    const cfg = { bucket: "test-reset", windowSec: 1, max: 1 }

    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0))

    const r1 = await checkApiRateLimit(id, cfg)
    expect(r1.allowed).toBe(true)

    const r2 = await checkApiRateLimit(id, cfg)
    expect(r2.allowed).toBe(false)

    vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 2))
    const r3 = await checkApiRateLimit(id, cfg)
    expect(r3.allowed).toBe(true)
    vi.useRealTimers()
  })

  it("exposes sensible presets for analytics and export", () => {
    expect(RATE_LIMITS.analytics.max).toBeGreaterThan(0)
    expect(RATE_LIMITS.analytics.windowSec).toBeLessThanOrEqual(300)
    expect(RATE_LIMITS.export.max).toBeLessThanOrEqual(5)
    expect(RATE_LIMITS.export.windowSec).toBeGreaterThanOrEqual(3600)
  })
})
