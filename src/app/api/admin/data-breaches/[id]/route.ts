/**
 * @route /api/admin/data-breaches/[id]
 * @description GET detail / PATCH update (description/remediation/cnilCaseNumber).
 *   Pour les transitions FSM (status), utiliser POST /[id]/transition.
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { DataBreachSeverity } from "@prisma/client"
import { AuthError } from "@/lib/auth"
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
  DATA_BREACH_BOUNDS,
} from "@/lib/services/data-breach.service"

const MAX_BODY_BYTES = 50_000

const paramsSchema = z.object({ id: z.coerce.number().int().positive() })

const updateSchema = z.object({
  severity: z.nativeEnum(DataBreachSeverity).optional(),
  description: z.string().max(DATA_BREACH_BOUNDS.MAX_DESCRIPTION_LEN).nullable().optional(),
  remediation: z.string().max(DATA_BREACH_BOUNDS.MAX_REMEDIATION_LEN).nullable().optional(),
  cnilCaseNumber: z.string().max(DATA_BREACH_BOUNDS.MAX_CNIL_CASE_NUMBER_LEN).nullable().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: "no fields to update" })

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = extractRequestContext(req)
  try {
    const raw = await params
    const parsedParams = paramsSchema.safeParse(raw)
    if (!parsedParams.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }
    const user = await auditedRequireRole(
      req, "ADMIN", ctx, "DATA_BREACH", String(parsedParams.data.id),
    )
    const breach = await dataBreachService.getById(parsedParams.data.id, user.id, ctx)
    if (!breach) {
      return NextResponse.json({ error: "notFound" }, { status: 404 })
    }
    return NextResponse.json({ breach })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "admin/data-breaches/:id GET", ctx.requestId)
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = extractRequestContext(req)
  try {
    const ctErr = assertJsonContentType(req)
    if (ctErr) return ctErr
    const sizeErr = assertBodySize(req, MAX_BODY_BYTES)
    if (sizeErr) return sizeErr

    const raw = await params
    const parsedParams = paramsSchema.safeParse(raw)
    if (!parsedParams.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }
    const user = await auditedRequireRole(
      req, "ADMIN", ctx, "DATA_BREACH", String(parsedParams.data.id),
    )

    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: "invalidJSON" }, { status: 400 })
    const parsedBody = updateSchema.safeParse(body)
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsedBody.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const breach = await dataBreachService.update(
      parsedParams.data.id, parsedBody.data, user.id, ctx,
    )
    return NextResponse.json({ breach })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    if (e instanceof DataBreachNotFoundError) {
      return NextResponse.json({ error: "notFound" }, { status: 404 })
    }
    if (e instanceof DataBreachValidationError) {
      return NextResponse.json({ error: "validationFailed", field: e.field }, { status: 422 })
    }
    return mapErrorToResponse(e, "admin/data-breaches/:id PATCH", ctx.requestId)
  }
}
