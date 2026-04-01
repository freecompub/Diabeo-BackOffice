/**
 * In-memory session revocation store.
 * Shared between middleware (Edge) and API routes (Node.js).
 * Entries auto-expire after 24h (JWT max lifetime).
 * TODO: Replace with Upstash Redis for multi-instance deployments.
 */

const revokedSessions = new Map<string, number>() // sid → expiry timestamp
const REVOCATION_TTL_MS = 24 * 3600_000

export function revokeSession(sid: string): void {
  revokedSessions.set(sid, Date.now() + REVOCATION_TTL_MS)
  // Cleanup old entries periodically
  if (revokedSessions.size > 1000) {
    const now = Date.now()
    for (const [key, expiry] of revokedSessions) {
      if (expiry < now) revokedSessions.delete(key)
    }
  }
}

export function isSessionRevoked(sid: string): boolean {
  const expiry = revokedSessions.get(sid)
  if (!expiry) return false
  if (expiry < Date.now()) {
    revokedSessions.delete(sid)
    return false
  }
  return true
}
