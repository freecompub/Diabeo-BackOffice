import { NextResponse } from "next/server"
import {
  extractBearerToken,
  verifyJwtAllowExpired,
  getSession,
  signJwt,
} from "@/lib/auth"
import { prisma } from "@/lib/db/client"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"

export async function POST(req: Request) {
  try {
    const token = extractBearerToken(req)
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const payload = await verifyJwtAllowExpired(token)

    // Check session is still valid in DB
    const session = await getSession(payload.sid)
    if (!session) {
      return NextResponse.json({ error: "Session expired or invalidated" }, { status: 401 })
    }

    // Fetch current user role (may have changed since token was issued)
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true },
    })

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 401 })
    }

    const newToken = await signJwt({
      sub: user.id,
      role: user.role,
      platform: "hc",
      sid: session.id,
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
      userId: user.id,
      expiresAt: session.expires.toISOString(),
    })
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 })
  }
}
