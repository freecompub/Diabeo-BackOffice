/**
 * @route /api/messages/unread-count
 * @description US-2076 scope A — badge unread count (polling 60s côté client).
 *
 * Endpoint optimisé : COUNT direct sur index
 * `(to_user_id, read_at, created_at)`. Pas d'audit row (lecture
 * non-sensitive : juste un compteur sans contenu).
 *
 * Auth : JWT requis. RBAC : tout user authentifié peut consulter son
 * propre compteur (jamais celui d'un autre).
 */
import { NextResponse, type NextRequest } from "next/server"
import { AuthError, requireAuth } from "@/lib/auth"
import { extractRequestContext } from "@/lib/services/audit.service"
import { mapErrorToResponse } from "@/lib/team-route-helpers"
import { messagingService } from "@/lib/services/messaging.service"

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const user = requireAuth(req)
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
