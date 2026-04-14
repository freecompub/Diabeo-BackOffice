/**
 * @module api-rate-limit
 * @description Generic sliding-window rate limiter for API routes.
 * Protects expensive endpoints (analytics, exports) from DoS and abuse.
 * Uses Upstash Redis with in-memory fallback for dev/test.
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

// In-memory fallback store: bucket → { windowStart, count }
const memoryFallback = new Map<string, { windowStart: number; count: number }>()

export interface ApiRateLimitConfig {
  /** Bucket name (e.g. "analytics", "export"). Scopes counters per endpoint family. */
  bucket: string
  /** Window size in seconds. */
  windowSec: number
  /** Max requests allowed per window per identifier. */
  max: number
}

export interface ApiRateLimitResult {
  allowed: boolean
  /** Remaining requests in current window (0 when blocked). */
  remaining: number
  /** Seconds until the current window expires (Retry-After header value). */
  retryAfterSec: number
}

function redisKey(bucket: string, identifier: string): string {
  return `${RATE_LIMIT_PREFIX}apirl:${bucket}:${identifier}`
}

/**
 * Check and consume one slot of the rate limit budget for an identifier.
 * Fail-open on Redis errors (logs and allows) — protects user availability.
 * @param identifier Usually `user.id` (number stringified) or IP for unauthenticated.
 * @param config Bucket + window + max.
 * @returns Allowed flag, remaining budget, retry-after seconds.
 */
export async function checkApiRateLimit(
  identifier: string,
  config: ApiRateLimitConfig,
): Promise<ApiRateLimitResult> {
  const { bucket, windowSec, max } = config
  const key = redisKey(bucket, identifier)
  const now = Math.floor(Date.now() / 1000)
  const client = getRedis()

  if (client) {
    try {
      // Fixed-window counter: INCR + set TTL on first hit.
      const count = await client.incr(key)
      if (count === 1) {
        await client.expire(key, windowSec)
      }
      const ttl = await client.ttl(key)
      const retryAfter = ttl > 0 ? ttl : windowSec
      if (count > max) {
        return { allowed: false, remaining: 0, retryAfterSec: retryAfter }
      }
      return { allowed: true, remaining: Math.max(0, max - count), retryAfterSec: retryAfter }
    } catch (err) {
      console.error(
        "[api-rate-limit] Redis error, failing open:",
        err instanceof Error ? err.message : err,
      )
      return { allowed: true, remaining: max, retryAfterSec: windowSec }
    }
  }

  // Fallback in-memory (dev/test only)
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
  /** Analytics: 30 requests per 60s per user. */
  analytics: { bucket: "analytics", windowSec: 60, max: 30 } satisfies ApiRateLimitConfig,
  /** Export RGPD: 3 requests per hour per user. */
  export: { bucket: "export", windowSec: 3600, max: 3 } satisfies ApiRateLimitConfig,
} as const
