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
 * Fallback: if Redis is unavailable, revocation check returns false
 * (fail-open). The JWT signature and expiration are still verified
 * cryptographically by the middleware. This matches the previous security
 * posture and avoids blocking all authenticated traffic on Redis outages.
 */

import { Redis } from "@upstash/redis"

const REVOCATION_PREFIX = "revoked:"
const DEFAULT_TTL_SECONDS = 24 * 3600 // 24h — matches JWT max lifetime

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
 */
export async function revokeSession(
  sid: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<void> {
  const client = getRedis()
  if (!client) {
    console.error("[revocation] Upstash Redis not configured — session revocation disabled")
    return
  }
  const ttl = Math.max(1, Math.ceil(ttlSeconds))
  await client.set(`${REVOCATION_PREFIX}${sid}`, "1", { ex: ttl })
}

/**
 * Check if a session has been revoked.
 * Returns false (fail-open) if Redis is unavailable.
 */
export async function isSessionRevoked(sid: string): Promise<boolean> {
  const client = getRedis()
  if (!client) return false
  try {
    const result = await client.get(`${REVOCATION_PREFIX}${sid}`)
    return result !== null
  } catch {
    // Fail-open: Redis unavailable → allow request (JWT still verified)
    return false
  }
}
