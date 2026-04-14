/**
 * POST /api/auth/mfa/challenge — unauthenticated (mfa-pending token only)
 *
 * Second leg of the login flow when MFA is enabled:
 *   1. POST /auth/login { email, password } → { mfaRequired: true, mfaToken }
 *   2. POST /auth/mfa/challenge { mfaToken, otp } → { expiresAt } + httpOnly cookie
 *
 * Rate-limited on failure. Emits MFA_CHALLENGE_FAILED on invalid OTP so
 * brute-force attempts are visible in audit and SIEM.
 *
 * Security notes:
 * - The mfaToken has audience `diabeo-mfa-pending` — the middleware rejects
 *   it on every protected route, so it cannot be used as a JWT bypass.
 * - The final JWT is returned as an httpOnly cookie (same as /auth/login) —
 *   never in the JSON body — matching the XSS-hardening of the main login.
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/db/client"
import {
  signJwt,
  verifyMfaPendingToken,
  createSession,
  checkRateLimit,
  recordFailedAttempt,
  clearAttempts,
} from "@/lib/auth"
import { mfaService } from "@/lib/services/mfa.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { logger } from "@/lib/logger"

const bodySchema = z.object({
  mfaToken: z.string().min(1),
  otp: z.string().regex(/^\d{6}$/),
})

export async function POST(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const body = await req.json().catch(() => ({}))
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    // Verify MFA-pending token BEFORE rate limiting the OTP bucket — an
    // invalid token means the caller never passed the password step, so we
    // should not reveal whether the user exists via rate-limit timing.
    let pending
    try {
      pending = await verifyMfaPendingToken(parsed.data.mfaToken)
    } catch {
      return NextResponse.json({ error: "invalidMfaToken" }, { status: 401 })
    }

    const rateLimitKey = `mfa-challenge:${pending.sub}`
    const rl = await checkRateLimit(rateLimitKey)
    if (rl.blocked) {
      return NextResponse.json(
        { error: "rateLimitExceeded" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds ?? 300) } },
      )
    }

    const user = await prisma.user.findUnique({
      where: { id: pending.sub },
      select: { id: true, role: true, mfaEnabled: true },
    })
    if (!user || !user.mfaEnabled) {
      // User deleted or MFA disabled between login and challenge — reject.
      return NextResponse.json({ error: "invalidMfaToken" }, { status: 401 })
    }

    const ok = await mfaService.verifyOtp(user.id, parsed.data.otp)
    if (!ok) {
      await recordFailedAttempt(rateLimitKey)
      await auditService.log({
        userId: user.id,
        action: "MFA_CHALLENGE_FAILED",
        resource: "SESSION",
        resourceId: String(user.id),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
        metadata: { phase: "challenge" },
      })
      return NextResponse.json({ error: "invalidOtp" }, { status: 401 })
    }

    // Success: issue full JWT + session, mirroring /auth/login response shape.
    // Tag the session as MFA-verified so HDS forensics can tell second-factor
    // sessions apart from password-only ones.
    await clearAttempts(rateLimitKey)
    const session = await createSession(user.id, { mfaVerified: true })
    const token = await signJwt({
      sub: user.id,
      role: user.role,
      platform: "hc",
      sid: session.id,
    })

    await auditService.log({
      userId: user.id,
      action: "LOGIN",
      resource: "SESSION",
      resourceId: session.id,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      metadata: { mfa: true },
    })

    const response = NextResponse.json({ expiresAt: session.expires.toISOString() })
    response.cookies.set("diabeo_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 24 * 60 * 60,
    })
    return response
  } catch (error) {
    logger.error("auth/mfa/challenge", "challenge failed", { requestId: ctx.requestId }, error)
    return NextResponse.json({ error: "serverUnavailable" }, { status: 503 })
  }
}
