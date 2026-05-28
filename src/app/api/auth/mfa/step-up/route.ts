/**
 * POST /api/auth/mfa/step-up — Plan B follow-up A2.
 *
 * Re-prove MFA pour les actions sensibles ADMIN. Bumpé `Session.mfaLastVerifiedAt`
 * → `requireFreshMfa` helper considère la session "fresh" pendant
 * `STEP_UP_WINDOW_SECONDS` (5 min).
 *
 * Pré-requis :
 *   - JWT valide (middleware injecte `x-user-id` + `x-session-id`).
 *   - User a `mfaEnabled = true` (sinon 403 `mfaEnrollmentRequired`).
 *
 * Body : `{ otp: "123456" }`.
 *
 * Rate-limit : 5 attempts / 5 min via `mfa-step-up:<userId>` bucket (cohérent
 * avec MFA challenge login).
 *
 * Audit :
 *   - succès : `MFA_STEP_UP_VERIFIED` (resourceId = sessionId).
 *   - échec OTP : `MFA_CHALLENGE_FAILED` (réutilise l'action existante US-2002).
 */

import { NextResponse, type NextRequest } from "next/server"
import { prisma } from "@/lib/db/client"
import {
  requireAuth,
  AuthError,
  checkRateLimit,
  recordFailedAttempt,
  clearAttempts,
} from "@/lib/auth"
import { mfaService } from "@/lib/services/mfa.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { logger } from "@/lib/logger"
import { mfaStepUpBodySchema } from "@/lib/schemas/auth"

export async function POST(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const user = requireAuth(req)
    if (!user.sessionId) {
      // JWT sans `sid` — flow legacy avant US-2007. Refuse plutôt que de
      // bumper sur une session inexistante.
      return NextResponse.json({ error: "sessionRequired" }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const parsed = mfaStepUpBodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    // Rate-limit AVANT le verify pour ne pas exposer le timing (un attacker
    // pourrait sinon différencier "userId existe" vs "userId inexistant").
    const rateLimitKey = `mfa-step-up:${user.id}`
    const rl = await checkRateLimit(rateLimitKey)
    if (rl.blocked) {
      return NextResponse.json(
        { error: "rateLimitExceeded" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds ?? 300) } },
      )
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { mfaEnabled: true },
    })
    if (!dbUser?.mfaEnabled) {
      // MFA non-enrôlée → l'utilisateur doit setup d'abord. Erreur dédiée
      // (vs 401 invalidOtp) pour que l'UI prompt l'enrôlement plutôt que
      // de redemander le code.
      return NextResponse.json({ error: "mfaEnrollmentRequired" }, { status: 403 })
    }

    const verifiedAt = await mfaService.stepUp(user.id, user.sessionId, parsed.data.otp)
    if (!verifiedAt) {
      await recordFailedAttempt(rateLimitKey)
      await auditService.log({
        userId: user.id,
        action: "MFA_CHALLENGE_FAILED",
        resource: "SESSION",
        resourceId: user.sessionId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
        metadata: { phase: "step-up" },
      })
      return NextResponse.json({ error: "invalidOtp" }, { status: 401 })
    }

    await clearAttempts(rateLimitKey)
    await auditService.log({
      userId: user.id,
      action: "MFA_STEP_UP_VERIFIED",
      resource: "SESSION",
      resourceId: user.sessionId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      metadata: { verifiedAt: verifiedAt.toISOString() },
    })

    return NextResponse.json({
      verifiedAt: verifiedAt.toISOString(),
      // expiresAt = window 5 min (cohérent avec helper requireFreshMfa).
      // Le client peut afficher un countdown UX "MFA valide jusqu'à HH:MM".
      expiresAt: new Date(verifiedAt.getTime() + 5 * 60_000).toISOString(),
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error("auth/mfa/step-up", "step-up failed", { requestId: ctx.requestId }, error)
    return NextResponse.json({ error: "serverUnavailable" }, { status: 503 })
  }
}
