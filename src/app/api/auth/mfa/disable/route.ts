/**
 * POST /api/auth/mfa/disable — authenticated
 *
 * Disables MFA for the user. Body: { password, otp }.
 *
 * Defense-in-depth: requires BOTH the current password AND a valid current OTP.
 * A stolen authenticated session without the password cannot disable MFA to
 * simplify further account takeover; an attacker with just the password (but
 * not the phone) cannot disable MFA to bypass the second factor.
 *
 * Rate-limited on failure (same exponential backoff as /mfa/verify).
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { compare } from "bcryptjs"
import {
  requireAuth,
  AuthError,
  checkRateLimit,
  recordFailedAttempt,
  clearAttempts,
} from "@/lib/auth"
import { prisma } from "@/lib/db/client"
import { mfaService } from "@/lib/services/mfa.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { logger } from "@/lib/logger"

const bodySchema = z.object({
  password: z.string().min(1),
  otp: z.string().regex(/^\d{6}$/),
})

export async function POST(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const ctx = extractRequestContext(req)
    const rateLimitKey = `mfa-disable:${user.id}`

    const rl = await checkRateLimit(rateLimitKey)
    if (rl.blocked) {
      return NextResponse.json(
        { error: "rateLimitExceeded" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds ?? 300) } },
      )
    }

    const body = await req.json()
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const record = await prisma.user.findUnique({
      where: { id: user.id },
      select: { passwordHash: true, mfaEnabled: true },
    })
    if (!record || !record.passwordHash) {
      return NextResponse.json({ error: "mfaNotEnabled" }, { status: 400 })
    }
    if (!record.mfaEnabled) {
      return NextResponse.json({ error: "mfaNotEnabled" }, { status: 400 })
    }

    const passwordOk = await compare(parsed.data.password, record.passwordHash)
    const otpOk = await mfaService.verifyOtp(user.id, parsed.data.otp)

    if (!passwordOk || !otpOk) {
      await recordFailedAttempt(rateLimitKey)
      await auditService.log({
        userId: user.id,
        action: "MFA_CHALLENGE_FAILED",
        resource: "USER",
        resourceId: String(user.id),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
        metadata: { phase: "disable" },
      })
      // Uniform 401 so an attacker cannot tell which factor failed.
      return NextResponse.json({ error: "invalidCredentials" }, { status: 401 })
    }

    await clearAttempts(rateLimitKey)
    await mfaService.disable(user.id)
    await auditService.log({
      userId: user.id,
      action: "MFA_DISABLED",
      resource: "USER",
      resourceId: String(user.id),
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    })

    return NextResponse.json({ mfaEnabled: false })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const ctx = extractRequestContext(req)
    logger.error("auth/mfa/disable", "disable failed", { requestId: ctx.requestId }, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
