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
import { logger } from "@/lib/logger"

/** Fenêtre de fraîcheur — 5 min, cohérent avec UX banking apps. */
export const STEP_UP_WINDOW_SECONDS = 5 * 60

/**
 * A2 round 2 H-4 — Fenêtre durcie 1 min pour actions à impact externe
 * irréversible (notif CNIL via FSM data-breach transitions, exports PHI
 * massifs, JWT revoke forcés). Aligné banking apps "live mode" Stripe.
 */
export const STEP_UP_WINDOW_SECONDS_CRITICAL = 60

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
 * @param options.windowSeconds — fenêtre de fraîcheur custom. Default
 *   `STEP_UP_WINDOW_SECONDS` (5 min). Pour actions à impact externe
 *   irréversible (FSM data-breach CNIL), passer `STEP_UP_WINDOW_SECONDS_CRITICAL`
 *   (1 min) — A2 round 2 H-4.
 */
export async function checkFreshMfa(
  userId: number,
  sessionId: string | undefined,
  options?: { windowSeconds?: number },
): Promise<StepUpCheck> {
  if (!sessionId) return { ok: false, reason: "stepUpRequired" }

  const windowSeconds = options?.windowSeconds ?? STEP_UP_WINDOW_SECONDS

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
  if (ageSec >= windowSeconds) {
    return { ok: false, reason: "stepUpRequired" }
  }

  return { ok: true, verifiedAt: session.mfaLastVerifiedAt }
}

/**
 * Variante "throw-style" alignée avec `requireAuth` / `requireRole`.
 *
 * **A2 round 2 LO-6 / M-8** — Réservé pour usage futur : pattern HOF
 * intercepteur type `withAuth(role, freshMfa)` qui consoliderait
 * `requireRole + requireFreshMfa` en une seule annotation. Pas câblé dans
 * `mapErrorToResponse` actuellement (les routes adoptantes utilisent
 * `checkFreshMfa` return-style + `stepUpErrorResponse` pour conserver le
 * contrôle sur l'audit metadata.route route-spécifique).
 *
 * Si un caller adopte cette variante : catch `StepUpRequiredError` et
 * appeler `stepUpErrorResponse(err.reason, userId, sessionId, ctx, ...)`
 * manuellement OU enrichir `mapErrorToResponse` avec un `stepUpTarget`
 * analogue à `auditTarget`.
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
  options?: { windowSeconds?: number },
): Promise<Date> {
  const result = await checkFreshMfa(userId, sessionId, options)
  if (!result.ok) throw new StepUpRequiredError(result.reason)
  return result.verifiedAt
}

/**
 * Whitelist explicite des `reason` autorisées dans le header
 * `WWW-Authenticate` (LO-1 defense-in-depth anti CRLF injection si un
 * futur dev introduit `reason` venant d'input utilisateur).
 */
const ALLOWED_STEP_UP_REASONS: ReadonlySet<StepUpReason> = new Set<StepUpReason>([
  "mfaEnrollmentRequired",
  "stepUpRequired",
])

/**
 * Construit la response 401 avec `WWW-Authenticate: stepup` + audit
 * `MFA_STEP_UP_REQUIRED` via `auditService.requireStepUp` (A2 round 2 C-2 —
 * câble US-2265 burst detection : 50 events / 60s → RBAC_BREACH_BURST).
 *
 * Le client UI doit détecter ce header et :
 *   - `reason=mfaEnrollmentRequired` → rediriger vers `/account/security` setup
 *   - `reason=stepUpRequired` → afficher prompt OTP, POST step-up, retry action
 *
 * **A2 round 2 H-3** — Le custom header `X-Step-Up-Required: <reason>` est
 * AUSSI émis pour les clients qui ne parsent pas les schemes RFC 7235 custom
 * (browsers natifs, OkHttp Android, NSURLSession iOS interceptors génériques).
 */
export async function stepUpErrorResponse(
  reason: StepUpReason,
  userId: number,
  sessionId: string | undefined,
  ctx: AuditContext,
  routeMeta: { route: string },
): Promise<NextResponse> {
  // LO-1 — defense-in-depth whitelist (typage TS `StepUpReason` deja restrictif,
  // mais une régression future qui ouvre le type à `string` serait bloquée ici).
  if (!ALLOWED_STEP_UP_REASONS.has(reason)) {
    throw new Error(`stepUpErrorResponse: invalid reason "${reason}"`)
  }

  // A2 round 2 LO-2 — Sentinel explicite pour les JWT legacy sans sid.
  const auditResourceId = sessionId ?? "jwt-legacy-no-sid"

  // A2 round 2 M-10 — logger.warn sur audit fail (vs silent swallow).
  // C-2 — utilise requireStepUp (câble burst detection US-2265).
  try {
    await auditService.requireStepUp({
      userId,
      resource: "SESSION",
      resourceId: auditResourceId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      metadata: {
        route: routeMeta.route,
        reason,
        legacyJwt: sessionId === undefined ? true : undefined,
      },
    })
  } catch (err) {
    logger.warn("auth/step-up", "audit MFA_STEP_UP_REQUIRED failed", {
      kind: "stepup.audit.failed",
      userId,
      requestId: ctx.requestId,
      action: routeMeta.route,
      failMode: err instanceof Error ? err.message : String(err),
    })
  }

  return NextResponse.json(
    { error: reason },
    {
      status: 401,
      headers: {
        // RFC 7235 — challenge scheme custom `stepup` + param `reason`.
        "WWW-Authenticate": `stepup reason="${reason}", realm="diabeo"`,
        // H-3 — header custom non-RFC pour clients qui ne parsent pas
        // WWW-Authenticate (interceptors fetch génériques, OkHttp natif).
        "X-Step-Up-Required": reason,
        // ANSSI RGS §4.5 — pas de cache sur 401 sensibles.
        "Cache-Control": "no-store, no-cache, must-revalidate, private",
        Pragma: "no-cache",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    },
  )
}
