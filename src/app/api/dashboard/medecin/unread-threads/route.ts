/**
 * US-2602 (Ma journée) — Messages non lus (médecin).
 * GET — threads avec ≥ 1 message non lu pour le caller (top 5, récence).
 * minRole NURSE (DOCTOR/ADMIN éligibles).
 *
 * Audit : délégué à `messagingService.listThreads(..., "poll")` (1 row
 * coalescé par fenêtre — pas de pollution sur le polling 60s). Pas de
 * `auditedRequireRole` ici pour éviter un double audit.
 *
 * Consentement RGPD : messagerie = donnée santé Art. 9. Sans consentement
 * du caller, la carte dégrade en liste vide (un dashboard ne hard-fail pas).
 */

import { NextResponse, type NextRequest } from "next/server"
import { AuthError, requireRole } from "@/lib/auth"
import { requireGdprConsent } from "@/lib/gdpr"
import { unreadThreadsQuery } from "@/lib/services/doctor-dashboard.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { mapErrorToResponse } from "@/lib/team-route-helpers"

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const user = requireRole(req, "NURSE")
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json({ items: [] }, { headers: { "Cache-Control": "no-store, private" } })
    }
    const items = await unreadThreadsQuery.forCaller(user.id, ctx)
    return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store, private" } })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "dashboard/medecin/unread-threads GET", ctx.requestId)
  }
}
