import { NextResponse, type NextRequest } from "next/server"
import {
  extractBearerToken,
  verifyJwt,
  invalidateSession,
} from "@/lib/auth"
import { revokeSession } from "@/lib/auth/revocation"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"

export async function POST(req: NextRequest) {
  try {
    const token = extractBearerToken(req) ?? req.cookies.get("diabeo_token")?.value ?? null
    if (!token) {
      // Even without a valid token, clear the cookie to ensure logout
      const response = NextResponse.json({ error: "unauthorized" }, { status: 401 })
      response.cookies.set("diabeo_token", "", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
        maxAge: 0,
      })
      return response
    }

    const payload = await verifyJwt(token)
    const ctx = extractRequestContext(req)

    await invalidateSession(payload.sid)
    const ttlSeconds = payload.exp - Math.floor(Date.now() / 1000)
    const revoked = await revokeSession(payload.sid, ttlSeconds)

    await auditService.log({
      userId: payload.sub,
      action: "LOGOUT",
      resource: "SESSION",
      resourceId: payload.sid,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { revocationStatus: revoked ? "ok" : "failed" },
    })

    const response = NextResponse.json({ success: true })
    response.cookies.set("diabeo_token", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 0,
    })
    return response
  } catch (error) {
    if (error instanceof Error && error.message.includes("token")) {
      return NextResponse.json({ error: "tokenExpired" }, { status: 401 })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[auth/logout]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
