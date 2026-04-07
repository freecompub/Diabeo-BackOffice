/**
 * Rate limiting for login attempts via Upstash Redis.
 *
 * Replaces the previous in-memory Map which did not work across
 * Edge/Node.js runtimes (same class of bug as session revocation HR-5).
 *
 * Lockout progression: 0,0,0 failures = no lockout;
 * 3rd failure = 5min; 4th = 15min; 5th+ = 60min.
 *
 * Falls back to in-memory Map if Redis is not configured (dev/test).
 */

import { Redis } from "@upstash/redis"

const RATE_LIMIT_PREFIX = process.env.REDIS_KEY_PREFIX ?? "diabeo:prod:"
const LOCKOUT_SECONDS = [0, 0, 0, 300, 900, 3600] as const
const ATTEMPT_TTL_SECONDS = 3600 // 1h — auto-expire attempt records

let redis: Redis | null = null

function getRedis(): Redis | null {
  if (redis) return redis
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  redis = new Redis({ url, token })
  return redis
}

// Fallback in-memory store for dev/test without Redis
const memoryFallback = new Map<string, { count: number; lockedUntil: number | null }>()

function redisKey(id: string): string {
  return `${RATE_LIMIT_PREFIX}ratelimit:${id}`
}

export async function checkRateLimit(identifier: string): Promise<{
  blocked: boolean
  retryAfterSeconds?: number
}> {
  const client = getRedis()

  if (client) {
    try {
      const data = await client.get<{ count: number; lockedUntil: number | null }>(redisKey(identifier))
      if (!data?.lockedUntil) return { blocked: false }
      if (data.lockedUntil > Date.now()) {
        return {
          blocked: true,
          retryAfterSeconds: Math.ceil((data.lockedUntil - Date.now()) / 1000),
        }
      }
      return { blocked: false }
    } catch {
      return { blocked: false }
    }
  }

  // Fallback in-memory
  const entry = memoryFallback.get(identifier)
  if (!entry?.lockedUntil) return { blocked: false }
  if (entry.lockedUntil > Date.now()) {
    return {
      blocked: true,
      retryAfterSeconds: Math.ceil((entry.lockedUntil - Date.now()) / 1000),
    }
  }
  return { blocked: false }
}

export async function recordFailedAttempt(identifier: string): Promise<void> {
  const client = getRedis()

  if (client) {
    try {
      const key = redisKey(identifier)
      const data = await client.get<{ count: number; lockedUntil: number | null }>(key)
      const count = (data?.count ?? 0) + 1
      const idx = Math.min(count, LOCKOUT_SECONDS.length - 1)
      const duration = LOCKOUT_SECONDS[idx]
      const lockedUntil = duration > 0 ? Date.now() + duration * 1000 : null

      await client.set(key, { count, lockedUntil }, { ex: ATTEMPT_TTL_SECONDS })
      return
    } catch {
      // Fall through to memory
    }
  }

  // Fallback in-memory
  const entry = memoryFallback.get(identifier) ?? { count: 0, lockedUntil: null }
  entry.count++
  const idx = Math.min(entry.count, LOCKOUT_SECONDS.length - 1)
  const duration = LOCKOUT_SECONDS[idx]
  if (duration > 0) {
    entry.lockedUntil = Date.now() + duration * 1000
  }
  memoryFallback.set(identifier, entry)
}

export async function clearAttempts(identifier: string): Promise<void> {
  const client = getRedis()

  if (client) {
    try {
      await client.del(redisKey(identifier))
      return
    } catch {
      // Fall through to memory
    }
  }

  memoryFallback.delete(identifier)
}
