/**
 * @route POST /api/admin/data-breaches/[id]/transition
 * @description FSM transition pour DataBreach. Body : `{ to: status,
 *   usersNotifiedCount?: number (requis si to=notified_users) }`.
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { DataBreachStatus } from "@prisma/client"
import {
  AuthError,
  checkFreshMfa,
  stepUpErrorResponse,
  STEP_UP_WINDOW_SECONDS_CRITICAL,
} from "@/lib/auth"
import { extractRequestContext } from "@/lib/services/audit.service"
import {
  auditedRequireRole,
  mapErrorToResponse,
  assertJsonContentType,
  assertBodySize,
} from "@/lib/team-route-helpers"
import {
  dataBreachService,
  DataBreachValidationError,
  DataBreachNotFoundError,
  DataBreachStateError,
} from "@/lib/services/data-breach.service"
import { withIdempotency } from "@/lib/idempotency/with-idempotency"

const paramsSchema = z.object({ id: z.coerce.number().int().positive() })

const bodySchema = z.object({
  to: z.nativeEnum(DataBreachStatus),
  usersNotifiedCount: z.number().int().nonnegative().max(10_000_000).optional(),
})

/**
 * Plan B follow-up A1 round 2 (M-CR-4) — wrappé `withIdempotency`.
 * FSM transition `draft → notified_cnil` à risque double-submit (notif CNIL
 * envoyée 2× si replay sans dédup). UI iter 1 PR #457 envoie déjà
 * `Idempotency-Key: <UUID v4>` via `crypto.randomUUID()`.
 */
async function postHandler(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = extractRequestContext(req)
  try {
    const ctErr = assertJsonContentType(req)
    if (ctErr) return ctErr
    const sizeErr = assertBodySize(req, 10_000)
    if (sizeErr) return sizeErr

    const raw = await params
    const parsedParams = paramsSchema.safeParse(raw)
    if (!parsedParams.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }
    const user = await auditedRequireRole(
      req, "ADMIN", ctx, "DATA_BREACH", String(parsedParams.data.id),
    )

    // Plan B follow-up A2 round 2 H-4 — Step-up MFA exigé avec fenêtre
    // durcie 1 min (CRITICAL) sur les FSM transitions data-breach :
    // notification CNIL externe irréversible (RGPD Art. 33), email patients,
    // sévérité gonflée potentielle si session compromise. Banking apps "live
    // mode" Stripe = pattern équivalent.
    const stepUp = await checkFreshMfa(user.id, user.sessionId, {
      windowSeconds: STEP_UP_WINDOW_SECONDS_CRITICAL,
    })
    if (!stepUp.ok) {
      return stepUpErrorResponse(stepUp.reason, user.id, user.sessionId, ctx, {
        route: "admin/data-breaches/[id]/transition POST",
      })
    }

    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: "invalidJSON" }, { status: 400 })
    const parsedBody = bodySchema.safeParse(body)
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsedBody.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const breach = await dataBreachService.transition(
      parsedParams.data.id,
      parsedBody.data.to,
      user.id,
      { usersNotifiedCount: parsedBody.data.usersNotifiedCount },
      ctx,
    )
    return NextResponse.json({ breach })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    if (e instanceof DataBreachNotFoundError) {
      return NextResponse.json({ error: "notFound" }, { status: 404 })
    }
    if (e instanceof DataBreachStateError) {
      return NextResponse.json({ error: "invalidTransition", from: e.from, to: e.to }, { status: 409 })
    }
    if (e instanceof DataBreachValidationError) {
      return NextResponse.json({ error: "validationFailed", field: e.field }, { status: 422 })
    }
    return mapErrorToResponse(e, "admin/data-breaches/:id/transition POST", ctx.requestId)
  }
}

export const POST = withIdempotency(postHandler, {
  route: "admin/data-breaches/[id]/transition POST",
})
