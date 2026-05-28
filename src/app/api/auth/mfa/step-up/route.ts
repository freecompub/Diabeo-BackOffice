/**
 * POST /api/auth/mfa/step-up — Plan B follow-up A2.
 *
 * Re-prove MFA pour les actions sensibles ADMIN. Bumpé `Session.mfaLastVerifiedAt`
 * → `requireFreshMfa` helper considère la session "fresh" pendant
 * `STEP_UP_WINDOW_SECONDS` (5 min) ou `STEP_UP_WINDOW_SECONDS_CRITICAL`
 * (1 min pour FSM data-breach).
 *
 * Pré-requis :
 *   - JWT valide (middleware injecte `x-user-id` + `x-session-id`).
 *   - User a `mfaEnabled = true` (sinon 401 `mfaEnrollmentRequired` + WWW-Authenticate).
 *
 * Body : `{ otp: "123456" }`.
 *
 * Rate-limit : 3 attempts puis lockout 5/15/60 min progressif via
 * `mfa-step-up:<userId>` bucket (cohérent avec MFA challenge login).
 *
 * **A2 round 2 modifs** :
 *   - H-1 : `Cache-Control: no-store` + headers ANSSI sur TOUTES les responses.
 *   - L9 : `assertJsonContentType` (415) + `assertBodySize` (413).
 *   - M-1 : `expiresAt` calculé via `STEP_UP_WINDOW_SECONDS` (vs magic `5*60_000`).
 *   - LOW-4 : `mfaEnrollmentRequired` retourne 401 + `WWW-Authenticate` (vs 403)
 *     pour alignement avec `stepUpErrorResponse` (cohérence UI parsing).
 *
 * Audit :
 *   - succès : `MFA_STEP_UP_VERIFIED` (resourceId = sessionId).
 *   - échec OTP : `MFA_CHALLENGE_FAILED` (réutilise action existante US-2002).
 */

import { NextResponse, type NextRequest } from "next/server"
import { prisma } from "@/lib/db/client"
import {
  requireAuth,
  AuthError,
  checkRateLimit,
  recordFailedAttempt,
  clearAttempts,
  STEP_UP_WINDOW_SECONDS,
} from "@/lib/auth"
import { mfaService } from "@/lib/services/mfa.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { logger } from "@/lib/logger"
import { mfaStepUpBodySchema } from "@/lib/schemas/auth"
import { assertJsonContentType, assertBodySize } from "@/lib/team-route-helpers"

/**
 * Headers ANSSI RGS §4.5 + Diabeo baseline. Appliqué à TOUTES les responses
 * (succès et erreurs) pour éviter qu'un proxy/CDN mal configuré cache un
 * 200 OK contenant `verifiedAt` (donnée de session sensible).
 */
const ANSSI_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, no-cache, must-revalidate, private",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
}

function jsonAnssi(body: unknown, status: number, extraHeaders?: Record<string, string>): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { ...ANSSI_HEADERS, ...(extraHeaders ?? {}) },
  })
}

/**
 * LOW-4 — Helper pour aligner `mfaEnrollmentRequired` sur le pattern
 * `stepUpErrorResponse` (401 + `WWW-Authenticate: stepup` +
 * `X-Step-Up-Required`). Frontend détecte une seule sémantique.
 */
function mfaEnrollmentRequiredResponse(): NextResponse {
  return jsonAnssi(
    { error: "mfaEnrollmentRequired" },
    401,
    {
      "WWW-Authenticate": `stepup reason="mfaEnrollmentRequired", realm="diabeo"`,
      "X-Step-Up-Required": "mfaEnrollmentRequired",
    },
  )
}

export async function POST(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const user = requireAuth(req)
    if (!user.sessionId) {
      return jsonAnssi({ error: "sessionRequired" }, 401)
    }

    // L9 — guards baseline Diabeo (content-type + body size).
    const ctErr = assertJsonContentType(req)
    if (ctErr) return jsonAnssi({ error: "unsupportedMediaType" }, 415)
    const sizeErr = assertBodySize(req, 1024) // body {otp:"123456"} ≈ 20 bytes
    if (sizeErr) return jsonAnssi({ error: "payloadTooLarge", maxBytes: 1024 }, 413)

    const body = await req.json().catch(() => ({}))
    const parsed = mfaStepUpBodySchema.safeParse(body)
    if (!parsed.success) {
      return jsonAnssi(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        400,
      )
    }

    // Rate-limit AVANT le verify pour ne pas exposer le timing.
    const rateLimitKey = `mfa-step-up:${user.id}`
    const rl = await checkRateLimit(rateLimitKey)
    if (rl.blocked) {
      return jsonAnssi(
        { error: "rateLimitExceeded" },
        429,
        { "Retry-After": String(rl.retryAfterSeconds ?? 300) },
      )
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { mfaEnabled: true },
    })
    if (!dbUser?.mfaEnabled) {
      // LOW-4 — 401 + WWW-Authenticate (vs ancien 403 sans header).
      return mfaEnrollmentRequiredResponse()
    }

    const verifiedAt = await mfaService.stepUp(user.id, user.sessionId, parsed.data.otp)
    if (!verifiedAt) {
      await recordFailedAttempt(rateLimitKey)
      // Best-effort — un fail audit n'impacte pas la response 401.
      try {
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
      } catch (err) {
        logger.warn("auth/mfa/step-up", "audit MFA_CHALLENGE_FAILED failed", {
          kind: "stepup.audit.failed",
          userId: user.id,
          requestId: ctx.requestId,
          failMode: err instanceof Error ? err.message : String(err),
        })
      }
      return jsonAnssi({ error: "invalidOtp" }, 401)
    }

    // H-T3 — On commit l'audit AVANT clearAttempts pour garantir la trace
    // forensique HDS même si Redis (clearAttempts) throw. La session est
    // déjà bumpée → la fenêtre fresh est ouverte.
    try {
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
    } catch (err) {
      logger.warn("auth/mfa/step-up", "audit MFA_STEP_UP_VERIFIED failed", {
        kind: "stepup.audit.failed",
        userId: user.id,
        requestId: ctx.requestId,
        failMode: err instanceof Error ? err.message : String(err),
      })
    }
    // clearAttempts best-effort — un fail Redis ne doit pas invalider le 200.
    try {
      await clearAttempts(rateLimitKey)
    } catch (err) {
      logger.warn("auth/mfa/step-up", "clearAttempts failed (silent)", {
        kind: "stepup.ratelimit.clear_failed",
        userId: user.id,
        failMode: err instanceof Error ? err.message : String(err),
      })
    }

    return jsonAnssi({
      verifiedAt: verifiedAt.toISOString(),
      // M-1 — `expiresAt` aligné `STEP_UP_WINDOW_SECONDS` (vs magic literal).
      expiresAt: new Date(verifiedAt.getTime() + STEP_UP_WINDOW_SECONDS * 1000).toISOString(),
    }, 200)
  } catch (error) {
    if (error instanceof AuthError) {
      return jsonAnssi({ error: error.message }, error.status)
    }
    logger.error("auth/mfa/step-up", "step-up failed", { requestId: ctx.requestId }, error)
    return jsonAnssi({ error: "serverUnavailable" }, 503)
  }
}
