/**
 * @route DELETE /api/account/sessions/[id]
 * @description Révoque une session spécifique du user authentifié.
 *   Si la session ciblée est la session courante = équivaut à logout.
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError, requireAuth } from "@/lib/auth"
import { extractRequestContext } from "@/lib/services/audit.service"
import { mapErrorToResponse } from "@/lib/team-route-helpers"
import {
  sessionManagementService,
  SessionNotFoundError,
} from "@/lib/services/session-management.service"

const paramsSchema = z.object({ id: z.string().min(1).max(64) })

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = extractRequestContext(req)
  try {
    const raw = await params
    const parsed = paramsSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }
    const user = requireAuth(req)
    if (!user.sessionId) {
      return NextResponse.json({ error: "missingSessionId" }, { status: 401 })
    }
    const result = await sessionManagementService.revokeOne(
      user.id, parsed.data.id, user.sessionId, ctx,
    )
    return NextResponse.json(result)
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    if (e instanceof SessionNotFoundError) {
      return NextResponse.json({ error: "notFound" }, { status: 404 })
    }
    return mapErrorToResponse(e, "account/sessions/:id DELETE", ctx.requestId)
  }
}
