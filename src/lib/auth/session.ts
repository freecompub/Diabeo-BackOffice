import { prisma } from "@/lib/db/client"
import { randomBytes } from "crypto"
import { revokeSession } from "./revocation"

const SESSION_DURATION_HOURS = 24

export async function createSession(userId: number) {
  const sessionToken = randomBytes(32).toString("hex")
  const expires = new Date(Date.now() + SESSION_DURATION_HOURS * 3600_000)

  return prisma.session.create({
    data: { sessionToken, userId, expires },
  })
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
  await Promise.all(sessions.map((s) => revokeSession(s.id)))
  return prisma.session.deleteMany({ where: { userId } })
}
