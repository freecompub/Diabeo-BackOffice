/**
 * @route /api/messages/[id]/read
 * @description US-2076 scope A — Marque un message reçu comme lu.
 *
 * Idempotent : si déjà lu → 200 avec `alreadyRead: true`.
 * Anti-énumération : si l'appelant n'est pas le destinataire,
 * 404 + audit `accessDenied` (US-2265 burst detection).
 *
 * Auth : JWT requis.
 * Audit : `MESSAGE/UPDATE` resource_id = message.id, `metadata.kind = "message.markRead"`.
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError, requireAuth } from "@/lib/auth"
import { extractRequestContext } from "@/lib/services/audit.service"
import { mapErrorToResponse } from "@/lib/team-route-helpers"
import {
  messagingService,
  MessagingNotFoundError,
} from "@/lib/services/messaging.service"

// Cuid format : alphanumeric + hyphen + underscore (max 64 chars).
// Permissif pour supporter cuid1/cuid2/ulid sans coupler à un format précis.
const paramsSchema = z.object({
  id: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/),
})

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = extractRequestContext(req)
  try {
    const user = requireAuth(req)
    const raw = await params
    const parsedParams = paramsSchema.safeParse(raw)
    if (!parsedParams.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }

    try {
      const result = await messagingService.markRead(
        user.id,
        parsedParams.data.id,
        ctx,
      )
      return NextResponse.json(result)
    } catch (e) {
      if (e instanceof MessagingNotFoundError) {
        return NextResponse.json({ error: "notFound" }, { status: 404 })
      }
      throw e
    }
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    return mapErrorToResponse(e, "messages/:id/read PUT", ctx.requestId)
  }
}
