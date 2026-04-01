/**
 * In-memory login rate limiter.
 * Tracks failed attempts by identifier (emailHmac).
 * After 3 failures: 5min lockout, then 15min, then 60min.
 */

interface AttemptRecord {
  count: number
  lockedUntil: number | null // epoch ms
}

const attempts = new Map<string, AttemptRecord>()

// Lockout durations in seconds, indexed by failure count (0-based)
// 0,1,2 failures = no lockout; 3rd = 5min; 4th = 15min; 5th+ = 60min
const LOCKOUT_SECONDS = [0, 0, 0, 300, 900, 3600] as const

export function checkRateLimit(identifier: string): {
  blocked: boolean
  retryAfterSeconds?: number
} {
  const entry = attempts.get(identifier)
  if (!entry?.lockedUntil) return { blocked: false }

  if (entry.lockedUntil > Date.now()) {
    return {
      blocked: true,
      retryAfterSeconds: Math.ceil((entry.lockedUntil - Date.now()) / 1000),
    }
  }

  return { blocked: false }
}

export function recordFailedAttempt(identifier: string): void {
  const entry = attempts.get(identifier) ?? { count: 0, lockedUntil: null }
  entry.count++

  const idx = Math.min(entry.count, LOCKOUT_SECONDS.length - 1)
  const duration = LOCKOUT_SECONDS[idx]

  if (duration > 0) {
    entry.lockedUntil = Date.now() + duration * 1000
  }

  attempts.set(identifier, entry)
}

export function clearAttempts(identifier: string): void {
  attempts.delete(identifier)
}
