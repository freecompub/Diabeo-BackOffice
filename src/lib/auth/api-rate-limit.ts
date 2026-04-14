/**
 * @module api-rate-limit
 * @description Fixed-window per-identifier rate limiter for API routes.
 * Protects expensive endpoints (analytics, RGPD exports) from DoS and abuse.
 *
 * Uses a server-side Lua script via Upstash Redis `eval` to make INCR+EXPIRE
 * atomic (prevents orphan-key lockouts on partial failures). Falls back to an
 * in-memory Map for dev/test environments without Upstash credentials.
 *
 * **Fail modes** — `failMode: "open" | "closed"`:
 * - `open` (default): when Redis is unreachable, allow the request. Appropriate
 *   for analytics where availability is more important than strict limits.
 * - `closed`: when Redis is unreachable, reject. Required for RGPD export or
 *   any endpoint where an unbounded rate would amplify data-exfiltration risk.
 *
 * @see CLAUDE.md — Backlog: rate limiting on analytics/export
 */

import { Redis } from "@upstash/redis"

const RATE_LIMIT_PREFIX = process.env.REDIS_KEY_PREFIX ?? "diabeo:prod:"

let redis: Redis | null = null

function getRedis(): Redis | null {
  if (redis) return redis
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  redis = new Redis({ url, token })
  return redis
}

// In-memory fallback: bucket → { windowStart, count }. Dev/test only.
const memoryFallback = new Map<string, { windowStart: number; count: number }>()

/**
 * Atomic Lua script — INCR + EXPIRE + TTL in one server round-trip.
 * Also re-issues EXPIRE if the key exists without TTL (defense against a prior
 * failed EXPIRE that left an orphan key).
 */
const RATE_LIMIT_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("TTL", KEYS[1])
if ttl < 0 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { count, ttl }
`

export interface ApiRateLimitConfig {
  /** Bucket name (e.g. "analytics", "export"). Scopes counters per endpoint. */
  bucket: string
  /** Window size in seconds. */
  windowSec: number
  /** Max requests allowed per window per identifier. */
  max: number
  /** Behavior on Redis outage. Default "open". */
  failMode?: "open" | "closed"
}

export interface ApiRateLimitResult {
  allowed: boolean
  /** Remaining requests in current window (0 when blocked). */
  remaining: number
  /** Seconds until the current window expires (Retry-After header value). */
  retryAfterSec: number
  /** True if Redis was unavailable and the result comes from the fail policy. */
  degraded?: boolean
}

function redisKey(bucket: string, identifier: string): string {
  return `${RATE_LIMIT_PREFIX}apirl:${bucket}:${identifier}`
}

/**
 * Check and consume one slot of the rate-limit budget for an identifier.
 * @param identifier Stable key (e.g. `user.id` stringified, or `ip:1.2.3.4`).
 * @param config Bucket + window + max + optional failMode.
 */
export async function checkApiRateLimit(
  identifier: string,
  config: ApiRateLimitConfig,
): Promise<ApiRateLimitResult> {
  const { bucket, windowSec, max, failMode = "open" } = config
  const key = redisKey(bucket, identifier)
  const client = getRedis()

  if (client) {
    try {
      const result = (await client.eval(
        RATE_LIMIT_SCRIPT,
        [key],
        [String(windowSec)],
      )) as [number, number]
      const [count, ttlRaw] = result
      const ttl = ttlRaw > 0 ? ttlRaw : windowSec
      if (count > max) {
        return { allowed: false, remaining: 0, retryAfterSec: ttl }
      }
      return { allowed: true, remaining: Math.max(0, max - count), retryAfterSec: ttl }
    } catch (err) {
      console.error(
        `[api-rate-limit] Redis error on bucket=${bucket} failMode=${failMode}:`,
        err instanceof Error ? err.message : err,
      )
      if (failMode === "closed") {
        return { allowed: false, remaining: 0, retryAfterSec: windowSec, degraded: true }
      }
      return { allowed: true, remaining: max, retryAfterSec: windowSec, degraded: true }
    }
  }

  // In-memory fallback (dev/test). Behaves consistently regardless of failMode.
  const now = Math.floor(Date.now() / 1000)
  const entry = memoryFallback.get(key)
  if (!entry || now - entry.windowStart >= windowSec) {
    memoryFallback.set(key, { windowStart: now, count: 1 })
    return { allowed: true, remaining: max - 1, retryAfterSec: windowSec }
  }
  entry.count++
  const retryAfter = windowSec - (now - entry.windowStart)
  if (entry.count > max) {
    return { allowed: false, remaining: 0, retryAfterSec: retryAfter }
  }
  return { allowed: true, remaining: Math.max(0, max - entry.count), retryAfterSec: retryAfter }
}

/** Preset configurations for common endpoint families. */
export const RATE_LIMITS = {
  /** Analytics: 30 req/60 s/user. Fail-open — availability first. */
  analytics: {
    bucket: "analytics",
    windowSec: 60,
    max: 30,
    failMode: "open",
  } satisfies ApiRateLimitConfig,
  /** Export RGPD per user: 3 req/h. Fail-closed — HDS data-exfiltration guard. */
  exportUser: {
    bucket: "export",
    windowSec: 3600,
    max: 3,
    failMode: "closed",
  } satisfies ApiRateLimitConfig,
  /** Export RGPD per IP: 10 req/h. Fail-closed — defense against token theft. */
  exportIp: {
    bucket: "export-ip",
    windowSec: 3600,
    max: 10,
    failMode: "closed",
  } satisfies ApiRateLimitConfig,
} as const
