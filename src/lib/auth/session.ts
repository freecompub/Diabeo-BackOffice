import { prisma } from "@/lib/db/client"
import { randomBytes } from "crypto"

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

export async function invalidateAllUserSessions(userId: number) {
  return prisma.session.deleteMany({ where: { userId } })
}
