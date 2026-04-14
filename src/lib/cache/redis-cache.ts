/**
 * @module redis-cache
 * @description Thin caching layer on Upstash Redis for hot read-heavy
 * queries (GDPR consent on 52+ routes, future HMAC lookups, etc.).
 *
 * **Fail-open policy**: if Redis is unavailable or errors, callers fall back
 * to the source of truth (PostgreSQL). A cache outage must never block user
 * operations. Each error is console.error'd so it surfaces in observability.
 *
 * Serialization: values are stored as JSON. `null` is a legitimate cached
 * value; a missing key is distinguished by `get` returning `undefined`.
 */

import { Redis } from "@upstash/redis"
import { logger } from "@/lib/logger"

const CACHE_PREFIX = process.env.REDIS_KEY_PREFIX ?? "diabeo:prod:"

let redis: Redis | null = null
function getRedis(): Redis | null {
  if (redis) return redis
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  redis = new Redis({ url, token })
  return redis
}

const memoryFallback = new Map<string, { value: unknown; expiresAt: number }>()

function nsKey(bucket: string, key: string): string {
  return `${CACHE_PREFIX}cache:${bucket}:${key}`
}

/**
 * Read a value from cache. Returns `undefined` for cache miss, the cached
 * value otherwise (including `null` if the source legitimately produced null).
 */
export async function cacheGet<T>(bucket: string, key: string): Promise<T | undefined> {
  const client = getRedis()
  if (client) {
    try {
      const raw = await client.get<T | null>(nsKey(bucket, key))
      return raw ?? undefined
    } catch (err) {
      logger.error("cache/redis", "get error, falling back to miss", { bucket, key }, err)
      return undefined
    }
  }

  const entry = memoryFallback.get(nsKey(bucket, key))
  if (!entry) return undefined
  if (entry.expiresAt < Date.now()) {
    memoryFallback.delete(nsKey(bucket, key))
    return undefined
  }
  return entry.value as T
}

/**
 * Write a value to cache with a TTL (seconds).
 * Fails silently on Redis errors — caching is best-effort.
 */
export async function cacheSet<T>(
  bucket: string,
  key: string,
  value: T,
  ttlSec: number,
): Promise<void> {
  const client = getRedis()
  if (client) {
    try {
      await client.set(nsKey(bucket, key), value, { ex: ttlSec })
      return
    } catch (err) {
      logger.error("cache/redis", "set error, skipping cache write", { bucket, key }, err)
      return
    }
  }
  memoryFallback.set(nsKey(bucket, key), { value, expiresAt: Date.now() + ttlSec * 1000 })
}

/**
 * Invalidate a single cache entry (used when the source of truth changes,
 * e.g. a PUT /api/account/privacy must invalidate the consent cache).
 */
export async function cacheDelete(bucket: string, key: string): Promise<void> {
  const client = getRedis()
  if (client) {
    try {
      await client.del(nsKey(bucket, key))
      return
    } catch (err) {
      logger.error("cache/redis", "delete error", { bucket, key }, err)
      return
    }
  }
  memoryFallback.delete(nsKey(bucket, key))
}
