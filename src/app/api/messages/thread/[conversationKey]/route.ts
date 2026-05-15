/**
 * @route /api/messages/thread/[conversationKey]
 * @description US-2076 scope A — Fetch messages d'un thread (paginé cursor).
 *
 * Auth : JWT requis. RBAC : `getThread` côté service vérifie que
 * l'appelant est l'un des deux participants ; 404 sinon (anti-énumération).
 * Audit : `MESSAGE/READ` resource_id = conversationKey, `metadata.kind`.
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError, requireAuth } from "@/lib/auth"
import { extractRequestContext } from "@/lib/services/audit.service"
import { mapErrorToResponse } from "@/lib/team-route-helpers"
import {
  messagingService,
  MESSAGING_BOUNDS,
  MessagingNotFoundError,
  MessagingValidationError,
} from "@/lib/services/messaging.service"

const paramsSchema = z.object({
  conversationKey: z
    .string()
    .length(MESSAGING_BOUNDS.CONVERSATION_KEY_LEN)
    .regex(/^[a-f0-9]{64}$/),
})

const querySchema = z.object({
  cursor: z.string().min(1).max(128).optional(),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(MESSAGING_BOUNDS.MAX_MESSAGES_PER_PAGE)
    .default(MESSAGING_BOUNDS.MAX_MESSAGES_PER_PAGE),
})

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ conversationKey: string }> },
) {
  const ctx = extractRequestContext(req)
  try {
    const user = requireAuth(req)
    const raw = await params
    const parsedParams = paramsSchema.safeParse(raw)
    if (!parsedParams.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }
    const parsedQuery = querySchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams.entries()),
    )
    if (!parsedQuery.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsedQuery.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    try {
      const result = await messagingService.getThread(
        user.id,
        parsedParams.data.conversationKey,
        parsedQuery.data,
        ctx,
      )
      return NextResponse.json(result)
    } catch (e) {
      if (e instanceof MessagingNotFoundError) {
        return NextResponse.json({ error: "notFound" }, { status: 404 })
      }
      if (e instanceof MessagingValidationError) {
        return NextResponse.json(
          { error: "validationFailed", field: e.field },
          { status: 422 },
        )
      }
      throw e
    }
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    return mapErrorToResponse(
      e,
      "messages/thread/:conversationKey GET",
      ctx.requestId,
    )
  }
}
