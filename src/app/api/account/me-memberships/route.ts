/**
 * GET /api/account/me-memberships
 *
 * US-2500-UI iter 4 — retourne les memberships healthcare du user
 * connecté pour pré-résoudre le memberId courant côté calendrier RDV.
 *
 * Auth : tout user authentifié (NURSE+/DOCTOR/ADMIN ont des memberships ;
 * VIEWER reçoit array vide).
 *
 * Response shape :
 * ```json
 * {
 *   "items": [
 *     { "memberId": 1, "memberName": "Dr Sophie Martin",
 *       "serviceId": 1, "serviceName": "Service Diabetologie",
 *       "establishment": "CHU Paris Test" }
 *   ]
 * }
 * ```
 *
 * Pas de PHI patient dans la réponse, donc pas de `requireGdprConsent`.
 * Headers ANSSI standard quand même appliqués pour cohérence.
 */

import { NextResponse, type NextRequest } from "next/server"
import { requireAuth, AuthError } from "@/lib/auth"
import { healthcareService } from "@/lib/services/healthcare.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { logger } from "@/lib/logger"

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const user = requireAuth(req)
    const items = await healthcareService.getMembershipsForUser(user.id)

    // Fix M-3 round 2 review PR #432 — audit READ minimaliste pour
    // forensique HDS (énumération memberships en cas de token volé).
    // Pas de PHI dans metadata, juste count + kind.
    await auditService.log({
      userId: user.id,
      action: "READ",
      resource: "HEALTHCARE_SERVICE",
      resourceId: "self",
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      metadata: { kind: "me-memberships", count: items.length },
    })

    const res = NextResponse.json({ items })
    // Fix M-1 round 2 review PR #432 — Cohérence headers ANSSI avec
    // pattern H-2 PR #431 (`Pragma: no-cache` pour proxies HTTP/1.0).
    res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, private")
    res.headers.set("Pragma", "no-cache")
    res.headers.set("Referrer-Policy", "no-referrer")
    res.headers.set("X-Content-Type-Options", "nosniff")
    return res
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error(
      "account/me-memberships",
      "GET failed",
      { kind: "route.error", requestId: ctx.requestId },
      error,
    )
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
