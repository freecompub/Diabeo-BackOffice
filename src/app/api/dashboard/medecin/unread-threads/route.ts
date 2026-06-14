/**
 * US-2602 (Ma journée) — Messages non lus (médecin).
 * GET — threads avec ≥ 1 message non lu pour le caller (top 5, récence).
 * minRole NURSE (DOCTOR/ADMIN éligibles).
 *
 * Audit : succès délégué à `messagingService.listThreads(..., "poll")` (1 row
 * coalescé par fenêtre — pas de pollution sur le polling 60s) ; les refus 403
 * sont, eux, audités via `auditedRequireRole` (US-2265 burst detection).
 *
 * Consentement RGPD : messagerie = donnée santé Art. 9. Sans consentement
 * du caller, la carte dégrade en liste vide (un dashboard ne hard-fail pas).
 *
 * ⚠️ Indistinguabilité VOULUE : le cas « consentement absent/révoqué » renvoie
 * exactement la même réponse (`{ items: [] }`, même `Cache-Control`) qu'une
 * boîte de réception réellement vide. C'est délibéré (anti-signal open-space,
 * RGPD Art. 5.1.f / Art. 9) — comme le badge non lus du `NavigationShell` :
 * ne JAMAIS révéler l'état de consentement d'un PS à un tiers (open-space,
 * partage d'écran). Ne pas « corriger » en différenciant les deux états.
 */

import { NextResponse, type NextRequest } from "next/server"
import { AuthError } from "@/lib/auth"
import { requireGdprConsent } from "@/lib/gdpr"
import { unreadThreadsQuery } from "@/lib/services/doctor-dashboard.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    // `auditedRequireRole` n'audite QUE le refus (403) — pas le succès, qui
    // reste délégué à `listThreads("poll")` (audit coalescé, pas de double
    // audit). Comble l'asymétrie de traçabilité des tentatives non autorisées
    // (US-2265 burst detection) avec la route sœur pending-proposals.
    const user = await auditedRequireRole(req, "NURSE", ctx, "MESSAGE", "0")
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
