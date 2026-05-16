/**
 * @route /api/cabinet/[id]/sms-config
 * @description US-2506 V1 mock — Admin SMS config cabinet.
 *
 *   - GET : lit `{ smsEnabled, smsCreditBalance }` (ADMIN only).
 *   - PUT : update flag + crédits (ADMIN only). Audit transitions.
 *
 * V1 mock — pas de vrai provider Twilio/OVH (US-2506bis V3).
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError, requireRole } from "@/lib/auth"
import { extractRequestContext } from "@/lib/services/audit.service"
import {
  assertJsonContentType,
  assertBodySize,
  mapErrorToResponse,
} from "@/lib/team-route-helpers"
import {
  smsService,
  SmsValidationError,
} from "@/lib/services/sms.service"

const paramsSchema = z.object({
  id: z.coerce.number().int().positive(),
})

const putBodySchema = z.object({
  smsEnabled: z.boolean().optional(),
  smsCreditBalance: z.number().int().nonnegative().max(1_000_000).optional(),
}).refine(
  (v) => v.smsEnabled !== undefined || v.smsCreditBalance !== undefined,
  { message: "atLeastOneFieldRequired" },
)

const SECURITY_HEADERS = {
  "Cache-Control": "no-store, private",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const

function jsonResponse(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: SECURITY_HEADERS })
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = extractRequestContext(req)
  try {
    const raw = await params
    const parsedParams = paramsSchema.safeParse(raw)
    if (!parsedParams.success) {
      return jsonResponse({ error: "validationFailed" }, 400)
    }
    // ADMIN only — config cabinet sensible (toggle billable SMS).
    requireRole(req, "ADMIN")

    try {
      const config = await smsService.getConfig(parsedParams.data.id)
      return jsonResponse(config)
    } catch (e) {
      if (e instanceof SmsValidationError && e.field === "cabinetId") {
        return jsonResponse({ error: "notFound" }, 404)
      }
      throw e
    }
  } catch (e) {
    if (e instanceof AuthError) {
      return jsonResponse({ error: e.message }, e.status)
    }
    return mapErrorToResponse(e, "cabinet/:id/sms-config GET", ctx.requestId)
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = extractRequestContext(req)
  try {
    const ctErr = assertJsonContentType(req)
    if (ctErr) return ctErr
    const sizeErr = assertBodySize(req, 512)
    if (sizeErr) return sizeErr

    const raw = await params
    const parsedParams = paramsSchema.safeParse(raw)
    if (!parsedParams.success) {
      return jsonResponse({ error: "validationFailed" }, 400)
    }
    const user = requireRole(req, "ADMIN")

    const body = await req.json().catch(() => null)
    if (!body) {
      return jsonResponse({ error: "invalidJSON" }, 400)
    }
    const parsedBody = putBodySchema.safeParse(body)
    if (!parsedBody.success) {
      return jsonResponse(
        { error: "validationFailed", details: parsedBody.error.flatten().fieldErrors },
        422,
      )
    }

    try {
      const updated = await smsService.updateConfig(
        parsedParams.data.id, parsedBody.data, user.id, ctx,
      )
      return jsonResponse(updated)
    } catch (e) {
      if (e instanceof SmsValidationError) {
        if (e.field === "cabinetId") {
          return jsonResponse({ error: "notFound" }, 404)
        }
        return jsonResponse(
          { error: "validationFailed", field: e.field, reason: e.reason },
          422,
        )
      }
      throw e
    }
  } catch (e) {
    if (e instanceof AuthError) {
      return jsonResponse({ error: e.message }, e.status)
    }
    return mapErrorToResponse(e, "cabinet/:id/sms-config PUT", ctx.requestId)
  }
}
