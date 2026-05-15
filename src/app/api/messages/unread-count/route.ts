/**
 * @route /api/messages/unread-count
 * @description US-2076 scope A — badge unread count (polling 60s côté client).
 *
 * Endpoint optimisé : COUNT direct sur index
 * `(to_user_id, read_at, created_at)`. Pas d'audit row (lecture agrégée
 * non-sensitive : compteur sans contenu PHI — documenté en DPIA).
 *
 * Auth : JWT requis. RBAC : tout user authentifié peut consulter son
 * propre compteur (jamais celui d'un autre).
 *
 * RGPD (MED-1 review round 3) : `requireGdprConsent` câblé pour cohérence
 * avec les 3 autres routes messagerie. Si user a révoqué son consent,
 * retourne `{ count: 0 }` (anti-leak : pas de signal "tu as N messages
 * en attente" si tu n'as plus de base légale pour les lire).
 */
import { NextResponse, type NextRequest } from "next/server"
import { AuthError, requireAuth } from "@/lib/auth"
import { extractRequestContext } from "@/lib/services/audit.service"
import { mapErrorToResponse } from "@/lib/team-route-helpers"
import { requireGdprConsent } from "@/lib/gdpr"
import { messagingService } from "@/lib/services/messaging.service"

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const user = requireAuth(req)
    // MED-1 review round 3 — consent obligatoire ; si révoqué, count=0
    // (anti-leak vs 403 qui révèlerait au client un changement d'état).
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json(
        { count: 0 },
        { headers: { "Cache-Control": "no-store, private" } },
      )
    }
    const result = await messagingService.unreadCount(user.id)
    return NextResponse.json(result, {
      headers: {
        // Anti-cache navigateur — le badge doit refléter l'état temps réel.
        "Cache-Control": "no-store, private",
      },
    })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    return mapErrorToResponse(e, "messages/unread-count GET", ctx.requestId)
  }
}
