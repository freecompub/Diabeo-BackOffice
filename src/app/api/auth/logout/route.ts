import { NextResponse } from "next/server"
import {
  extractBearerToken,
  verifyJwt,
  invalidateSession,
} from "@/lib/auth"
import { revokeSession } from "@/middleware"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"

export async function POST(req: Request) {
  try {
    const token = extractBearerToken(req)
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const payload = await verifyJwt(token)
    const ctx = extractRequestContext(req)

    await invalidateSession(payload.sid)
    revokeSession(payload.sid)

    await auditService.log({
      userId: payload.sub,
      action: "LOGOUT",
      resource: "SESSION",
      resourceId: payload.sid,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 })
  }
}
