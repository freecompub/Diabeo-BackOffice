import { NextResponse, type NextRequest } from "next/server"
import {
  extractBearerToken,
  verifyJwtAllowExpired,
  getSession,
  signJwt,
} from "@/lib/auth"
import { touchSession } from "@/lib/auth/session"
import { isSessionRevoked } from "@/lib/auth/revocation"
import { prisma } from "@/lib/db/client"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"

export async function POST(req: NextRequest) {
  try {
    const token = extractBearerToken(req)
    if (!token) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 })
    }

    const payload = await verifyJwtAllowExpired(token)

    // Check Redis revocation before allowing refresh (defense-in-depth)
    if (await isSessionRevoked(payload.sid)) {
      return NextResponse.json({ error: "sessionRevoked" }, { status: 401 })
    }

    // Check session is still valid in DB
    const session = await getSession(payload.sid)
    if (!session) {
      return NextResponse.json({ error: "sessionExpired" }, { status: 401 })
    }

    // US-2007 H1 (review re-1 PR #409) — bump lastSeenAt à chaque
    // refresh JWT (toutes les ~15 min). Fire-and-forget : un échec
    // ne doit pas bloquer le refresh. Le middleware Edge ne peut pas
    // appeler Prisma, donc refresh est le checkpoint Node naturel.
    void touchSession(session.id)

    // Fetch current user role/status/authVersion (may have changed since issue).
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, status: true, authVersion: true },
    })

    if (!user) {
      return NextResponse.json({ error: "userNotFound" }, { status: 401 })
    }

    // US-2148 / F7 — re-valide le statut au refresh (le middleware Edge ne lit pas
    // la base) : un compte suspendu/archivé après l'émission ne peut plus rafraîchir.
    if (user.status !== "active") {
      return NextResponse.json({ error: "accountSuspended" }, { status: 401 })
    }

    // US-2619/F7 — révocation immédiate des droits : un token dont `av` est
    // antérieur à `User.authVersion` (rôle/statut/capacités changés) est refusé.
    if (payload.av !== user.authVersion) {
      return NextResponse.json({ error: "authVersionStale" }, { status: 401 })
    }

    const newToken = await signJwt({
      sub: user.id,
      role: user.role,
      platform: "hc",
      sid: session.id,
      av: user.authVersion,
    })

    const ctx = extractRequestContext(req)
    await auditService.log({
      userId: user.id,
      action: "LOGIN",
      resource: "SESSION",
      resourceId: session.id,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { type: "refresh" },
    })

    return NextResponse.json({
      token: newToken,
      expiresAt: session.expires.toISOString(),
    })
  } catch {
    return NextResponse.json({ error: "tokenExpired" }, { status: 401 })
  }
}
