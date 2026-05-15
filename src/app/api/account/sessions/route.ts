/**
 * @route /api/account/sessions
 * @description Groupe 9 — US-2007 Sessions multiples UI.
 *   - GET    : liste les sessions actives du user authentifié
 *   - DELETE : révoque toutes les sessions SAUF la session courante
 */
import { NextResponse, type NextRequest } from "next/server"
import { AuthError, requireAuth } from "@/lib/auth"
import { extractRequestContext } from "@/lib/services/audit.service"
import { mapErrorToResponse } from "@/lib/team-route-helpers"
import { sessionManagementService } from "@/lib/services/session-management.service"

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const user = requireAuth(req)
    if (!user.sessionId) {
      return NextResponse.json({ error: "missingSessionId" }, { status: 401 })
    }
    const items = await sessionManagementService.listOwn(
      user.id, user.sessionId, ctx,
    )
    return NextResponse.json({ items })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "account/sessions GET", ctx.requestId)
  }
}

export async function DELETE(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const user = requireAuth(req)
    if (!user.sessionId) {
      return NextResponse.json({ error: "missingSessionId" }, { status: 401 })
    }
    const result = await sessionManagementService.revokeOthers(
      user.id, user.sessionId, ctx,
    )
    return NextResponse.json(result)
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "account/sessions DELETE", ctx.requestId)
  }
}
