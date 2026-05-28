/**
 * @module auth/step-up
 * @description Plan B follow-up A2 — Step-up MFA freshness check.
 *
 * `requireFreshMfa(req)` exige que la session ait été MFA-verified dans les
 * dernières `STEP_UP_WINDOW_SECONDS` (5 min default). Utilisé sur les actions
 * sensibles ADMIN (role/status changes, FSM data-breach transitions, financier).
 *
 * 3 résultats possibles :
 *   - `{ ok: true }` : MFA fresh, action autorisée.
 *   - `{ ok: false, reason: "mfaEnrollmentRequired" }` : `mfaEnabled = false`,
 *     l'utilisateur doit enrôler MFA (UI prompte `/api/auth/mfa/setup`).
 *   - `{ ok: false, reason: "stepUpRequired" }` : MFA enrôlée mais pas fresh,
 *     l'utilisateur doit re-prouver (UI prompte `/api/auth/mfa/step-up`).
 *
 * Le helper `stepUpErrorResponse(reason, ctx)` retourne 401 + `WWW-Authenticate:
 * stepup` (RFC-style) + audit `MFA_STEP_UP_REQUIRED` US-2265 burst detection.
 *
 * **Pourquoi pas un wrapper HOF** (vs `withIdempotency`) : la valeur du retour
 * est typée pour le caller (permet de logger metadata route-spécifique avant
 * renvoyer le 401). Plus flexible que `withIdempotency` qui interpose tout.
 */

import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/client"
import { auditService, type AuditContext } from "@/lib/services/audit.service"

/** Fenêtre de fraîcheur — 5 min, cohérent avec UX banking apps. */
export const STEP_UP_WINDOW_SECONDS = 5 * 60

export type StepUpReason = "mfaEnrollmentRequired" | "stepUpRequired"

export type StepUpCheck =
  | { ok: true; verifiedAt: Date }
  | { ok: false; reason: StepUpReason }

/**
 * Vérifie la fraîcheur MFA de la session courante.
 *
 * @param userId — depuis `requireAuth(req).id`
 * @param sessionId — depuis `requireAuth(req).sessionId`. Si absent → flow
 *   legacy JWT sans sid → on retourne `stepUpRequired` (force migration).
 */
export async function checkFreshMfa(
  userId: number,
  sessionId: string | undefined,
): Promise<StepUpCheck> {
  if (!sessionId) return { ok: false, reason: "stepUpRequired" }

  // Une seule query : session + user.mfaEnabled (FK constraint garantit
  // session.userId === userId, mais on guarde quand même en filter pour
  // defense-in-depth — un compromised JWT avec mauvais sid → no-op).
  const session = await prisma.session.findFirst({
    where: { id: sessionId, userId },
    select: {
      mfaLastVerifiedAt: true,
      user: { select: { mfaEnabled: true } },
    },
  })

  if (!session) {
    // Session révoquée ou cross-user spoof → stepUpRequired (l'UI prompt MFA
    // puis si toujours échec → middleware déconnecte).
    return { ok: false, reason: "stepUpRequired" }
  }

  if (!session.user.mfaEnabled) {
    return { ok: false, reason: "mfaEnrollmentRequired" }
  }

  if (!session.mfaLastVerifiedAt) {
    return { ok: false, reason: "stepUpRequired" }
  }

  const ageSec = (Date.now() - session.mfaLastVerifiedAt.getTime()) / 1000
  if (ageSec >= STEP_UP_WINDOW_SECONDS) {
    return { ok: false, reason: "stepUpRequired" }
  }

  return { ok: true, verifiedAt: session.mfaLastVerifiedAt }
}

/**
 * Variante "throw-style" alignée avec `requireAuth` / `requireRole` —
 * lance `StepUpRequiredError` si pas fresh. Le caller catch et renvoie via
 * `stepUpErrorResponse(err.reason, ctx, ...)`.
 */
export class StepUpRequiredError extends Error {
  constructor(public reason: StepUpReason) {
    super(reason)
    this.name = "StepUpRequiredError"
  }
}

export async function requireFreshMfa(
  userId: number,
  sessionId: string | undefined,
): Promise<Date> {
  const result = await checkFreshMfa(userId, sessionId)
  if (!result.ok) throw new StepUpRequiredError(result.reason)
  return result.verifiedAt
}

/**
 * Construit la response 401 avec `WWW-Authenticate: stepup` + audit
 * `MFA_STEP_UP_REQUIRED` (US-2265 burst detection sur répétition).
 *
 * Le client UI doit détecter ce header et :
 *   - `reason=mfaEnrollmentRequired` → rediriger vers `/account/security` setup
 *   - `reason=stepUpRequired` → afficher prompt OTP, POST step-up, retry action
 */
export async function stepUpErrorResponse(
  reason: StepUpReason,
  userId: number,
  sessionId: string | undefined,
  ctx: AuditContext,
  routeMeta: { route: string },
): Promise<NextResponse> {
  // Audit best-effort — un fail audit ne doit pas bloquer la response 401.
  try {
    await auditService.log({
      userId,
      action: "MFA_STEP_UP_REQUIRED",
      resource: "SESSION",
      resourceId: sessionId ?? "no-session",
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      metadata: { route: routeMeta.route, reason },
    })
  } catch {
    // silent — instrumenté via logger.warn dans audit.service.ts
  }

  return NextResponse.json(
    { error: reason },
    {
      status: 401,
      headers: {
        // RFC 7235 — challenge scheme custom `stepup` + param `reason`.
        // Le client iOS/web parse pour différencier enrôlement vs re-prove.
        "WWW-Authenticate": `stepup reason="${reason}", realm="diabeo"`,
        // ANSSI RGS §4.5 — pas de cache sur 401 sensibles.
        "Cache-Control": "no-store, no-cache, must-revalidate, private",
        "Pragma": "no-cache",
      },
    },
  )
}
