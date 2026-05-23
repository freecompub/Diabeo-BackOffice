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
import { extractRequestContext } from "@/lib/services/audit.service"
import { logger } from "@/lib/logger"

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const user = requireAuth(req)
    const items = await healthcareService.getMembershipsForUser(user.id)

    const res = NextResponse.json({ items })
    res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, private")
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
