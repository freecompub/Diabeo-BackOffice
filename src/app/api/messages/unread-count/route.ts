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
 * RGPD (MED-1 round 3 / NEW-L4 round 4) : `requireGdprConsent` câblé +
 * réponse 403 `gdprConsentRequired` cohérente avec les 3 autres routes.
 * Le client SAIT qu'il a révoqué son consent (action explicite), donc
 * pas de leak d'information à craindre vs silent count:0 (qui cassait
 * la cohérence API et la transparence RGPD Art. 12).
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
    // NEW-L4 review round 4 — 403 cohérent avec les 3 autres routes
    // (le client connaît son propre état de consent, pas de leak réel).
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json(
        { error: "gdprConsentRequired" },
        {
          status: 403,
          headers: { "Cache-Control": "no-store, private" },
        },
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
