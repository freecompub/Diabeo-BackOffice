/**
 * POST /api/auth/mfa/verify — authenticated
 *
 * First-time confirmation after `setup`. Accepts a 6-digit OTP, verifies it
 * against the freshly generated secret, and (only on success) sets
 * `mfaEnabled = true`. This is the only path that enables MFA.
 *
 * Rate-limited (`auth/rate-limit` keyed on `mfa-verify:<userId>`): 3 failed
 * attempts → exponential lockout. A failed attempt emits a MFA_CHALLENGE_FAILED
 * audit entry for HDS traceability.
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth, AuthError, checkRateLimit, recordFailedAttempt, clearAttempts } from "@/lib/auth"
import { mfaService } from "@/lib/services/mfa.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { logger } from "@/lib/logger"

const bodySchema = z.object({
  otp: z.string().regex(/^\d{6}$/, "OTP must be a 6-digit code"),
})

export async function POST(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const ctx = extractRequestContext(req)
    const rateLimitKey = `mfa-verify:${user.id}`

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

    const ok = await mfaService.verifyAndEnable(user.id, parsed.data.otp)
    if (!ok) {
      await recordFailedAttempt(rateLimitKey)
      await auditService.log({
        userId: user.id,
        action: "MFA_CHALLENGE_FAILED",
        resource: "USER",
        resourceId: String(user.id),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
        metadata: { phase: "verify" },
      })
      return NextResponse.json({ error: "invalidOtp" }, { status: 401 })
    }

    await clearAttempts(rateLimitKey)
    await auditService.log({
      userId: user.id,
      action: "MFA_ENABLED",
      resource: "USER",
      resourceId: String(user.id),
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    })

    return NextResponse.json({ mfaEnabled: true })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const ctx = extractRequestContext(req)
    logger.error("auth/mfa/verify", "verify failed", { requestId: ctx.requestId }, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
