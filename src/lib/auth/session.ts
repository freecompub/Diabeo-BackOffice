import { prisma } from "@/lib/db/client"
import { randomBytes } from "crypto"
import { revokeSession } from "./revocation"
import { clearActivity } from "./activity"

const SESSION_DURATION_HOURS = 24

/**
 * Create a session row.
 * @param userId  User the session belongs to.
 * @param opts.mfaVerified  True if the session was minted via /api/auth/mfa/challenge
 *   (HDS forensics — distinguishes second-factor sessions from password-only).
 * @param opts.ipAddress  Client IP at session creation (US-2007 UI device fingerprint).
 * @param opts.userAgent  User-Agent at session creation (idem).
 */
export async function createSession(
  userId: number,
  opts: {
    mfaVerified?: boolean
    ipAddress?: string
    userAgent?: string
  } = {},
) {
  const sessionToken = randomBytes(32).toString("hex")
  const expires = new Date(Date.now() + SESSION_DURATION_HOURS * 3600_000)

  return prisma.session.create({
    data: {
      sessionToken,
      userId,
      expires,
      mfaVerified: opts.mfaVerified ?? false,
      // Plan B follow-up A2 — Si MFA-verified au login, bumper aussi
      // `mfaLastVerifiedAt` pour que les actions sensibles dans les 5min
      // suivantes ne demandent pas de step-up immédiat (UX cohérent —
      // l'utilisateur vient de prouver MFA). L2 — `null` explicite
      // sémantique "pas de valeur" vs `undefined` (= field absent).
      mfaLastVerifiedAt: opts.mfaVerified ? new Date() : null,
      ipAddress: opts.ipAddress,
      userAgent: opts.userAgent ? opts.userAgent.slice(0, 500) : undefined,
    },
  })
}

/**
 * US-2007 — Bump `lastSeenAt`. Appelé en checkpoint Node (refresh JWT,
 * GET /sessions). Le middleware Edge ne peut pas appeler Prisma.
 * Fire-and-forget : un échec ne doit pas casser le flow appelant.
 */
export async function touchSession(sessionId: string): Promise<void> {
  try {
    await prisma.session.update({
      where: { id: sessionId },
      data: { lastSeenAt: new Date() },
    })
  } catch {
    // session deleted ou DB lente — no-op intentionnel.
  }
}

export async function getSession(sessionId: string) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
  })
  if (!session || session.expires < new Date()) return null
  return session
}

export async function invalidateSession(sessionId: string) {
  return prisma.session.delete({ where: { id: sessionId } }).catch(() => null)
}

/**
 * Invalidate all sessions for a user (account deletion, role change, admin action).
 * Revokes each session in Redis before deleting from DB, so that existing JWTs
 * are immediately rejected by the middleware.
 */
export async function invalidateAllUserSessions(userId: number) {
  const sessions = await prisma.session.findMany({
    where: { userId },
    select: { id: true },
  })
  // Révoque (Redis) + ferme la fenêtre d'activité (US-2621) de chaque session
  // AVANT la suppression DB → les JWT existants sont rejetés immédiatement.
  await Promise.all(
    sessions.flatMap((s) => [revokeSession(s.id), clearActivity(s.id)]),
  )
  return prisma.session.deleteMany({ where: { userId } })
}
