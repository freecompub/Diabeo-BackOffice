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
import { requireGdprConsent } from "@/lib/gdpr"
import {
  messagingService,
  MessagingNotFoundError,
} from "@/lib/services/messaging.service"

// H5 (review) — Format cuid1 strict (Prisma `@default(cuid())`) :
//   `c` + 24 caractères base36 lowercase. Resserre la regex pour éviter le
//   probing par timing sur des IDs arbitraires longs.
const paramsSchema = z.object({
  id: z.string().regex(/^c[a-z0-9]{24}$/, "invalidCuid"),
})

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = extractRequestContext(req)
  try {
    const user = requireAuth(req)
    // C1 (review) — Messagerie = données santé Art. 9 RGPD → consent obligatoire.
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
    }
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
      // NEW-L1 review round 4 — Anti-cache (readAt timestamp = info confidentielle).
      return NextResponse.json(result, {
        headers: { "Cache-Control": "no-store, private" },
      })
    } catch (e) {
      if (e instanceof MessagingNotFoundError) {
        return NextResponse.json(
          { error: "notFound" },
          {
            status: 404,
            headers: { "Cache-Control": "no-store, private" },
          },
        )
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
