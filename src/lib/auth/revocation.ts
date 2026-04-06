/**
 * Session revocation via Upstash Redis.
 *
 * On logout, the session ID (sid) is written to Redis with a TTL matching
 * the remaining JWT lifetime. The Edge middleware checks Redis before
 * allowing a request through.
 *
 * Upstash uses HTTP/fetch under the hood, making it compatible with both
 * Edge and Node.js runtimes — solving the cross-runtime isolation issue
 * that broke the previous in-memory Map approach.
 *
 * Security policy: **fail-closed** (HDS ISO 27001 A.9.4.2, ANSSI RGS v2.0).
 * If Redis is unavailable during a revocation check, the session is considered
 * revoked (request denied). This ensures that a Redis outage cannot be
 * exploited to bypass session invalidation for healthcare data access.
 */

import { Redis } from "@upstash/redis"

/** Environment-scoped prefix to avoid key collisions in shared Redis instances */
const APP_PREFIX = process.env.REDIS_KEY_PREFIX ?? "diabeo:prod:"
const REVOCATION_PREFIX = `${APP_PREFIX}revoked:`
const DEFAULT_TTL_SECONDS = 24 * 3600 // 24h — matches JWT max lifetime
const MIN_REVOCATION_TTL_SECONDS = 60 // minimum revocation window (clock drift safety)

let redis: Redis | null = null

function getRedis(): Redis | null {
  if (redis) return redis
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  redis = new Redis({ url, token })
  return redis
}

/**
 * Mark a session as revoked in Redis.
 * @param sid - JWT session ID (from the `sid` claim)
 * @param ttlSeconds - Time until the JWT expires (bounds Redis memory usage)
 * @returns true if revocation was written to Redis, false if it failed
 */
export async function revokeSession(
  sid: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<boolean> {
  const client = getRedis()
  if (!client) {
    console.error("[revocation] Upstash Redis not configured — session revocation disabled")
    return false
  }
  const ttl = Math.max(MIN_REVOCATION_TTL_SECONDS, Math.ceil(ttlSeconds))
  try {
    await client.set(`${REVOCATION_PREFIX}${sid}`, "1", { ex: ttl })
    return true
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error"
    console.error("[revocation] Failed to write revocation to Redis:", msg)
    return false
  }
}

/**
 * Check if a session has been revoked.
 *
 * **Fail-closed** (HDS compliance): returns true (revoked) if Redis is
 * unavailable. This prevents revoked sessions from being accepted during
 * a Redis outage. The trade-off is that a Redis outage blocks all
 * authenticated traffic — mitigated by short JWT lifetime (Phase 2).
 */
export async function isSessionRevoked(sid: string): Promise<boolean> {
  const client = getRedis()
  if (!client) return false // Redis not configured — skip check (dev/test)
  try {
    const result = await client.get(`${REVOCATION_PREFIX}${sid}`)
    return result !== null
  } catch {
    // Fail-closed: Redis unavailable → treat session as revoked (HDS compliance)
    console.error("[revocation] Redis unavailable — failing closed (session treated as revoked)")
    return true
  }
}

/**
 * Reset the cached Redis client. Test-only.
 * @internal
 */
export function _resetForTesting(): void {
  redis = null
}
