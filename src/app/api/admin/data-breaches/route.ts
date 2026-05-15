/**
 * @route /api/admin/data-breaches
 * @description US-2137 Notification violation CNIL (RGPD Art. 33).
 *   - GET  : liste filtrée par status / severity (ADMIN-only)
 *   - POST : déclare une nouvelle violation (status=draft)
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { DataBreachSeverity, DataBreachStatus } from "@prisma/client"
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
  DATA_BREACH_BOUNDS,
} from "@/lib/services/data-breach.service"

const MAX_BODY_BYTES = 50_000

const listQuerySchema = z.object({
  status: z.nativeEnum(DataBreachStatus).optional(),
  severity: z.nativeEnum(DataBreachSeverity).optional(),
  limit: z.coerce.number().int().positive().max(DATA_BREACH_BOUNDS.MAX_LIST_LIMIT).default(50),
  cursor: z.coerce.number().int().positive().optional(),
})

const declareSchema = z.object({
  severity: z.nativeEnum(DataBreachSeverity),
  title: z.string().trim().min(1).max(DATA_BREACH_BOUNDS.MAX_TITLE_LEN),
  description: z.string().max(DATA_BREACH_BOUNDS.MAX_DESCRIPTION_LEN).optional(),
  detectedAt: z.coerce.date().optional(),
})

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const parsed = listQuerySchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams.entries()),
    )
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const user = await auditedRequireRole(req, "ADMIN", ctx, "DATA_BREACH", "list")
    const items = await dataBreachService.list(parsed.data, user.id, ctx)
    return NextResponse.json({ items })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "admin/data-breaches GET", ctx.requestId)
  }
}

export async function POST(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const ctErr = assertJsonContentType(req)
    if (ctErr) return ctErr
    const sizeErr = assertBodySize(req, MAX_BODY_BYTES)
    if (sizeErr) return sizeErr

    const user = await auditedRequireRole(req, "ADMIN", ctx, "DATA_BREACH", "new")
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: "invalidJSON" }, { status: 400 })
    const parsed = declareSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const breach = await dataBreachService.declare(parsed.data, user.id, ctx)
    return NextResponse.json({ breach }, { status: 201 })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    if (e instanceof DataBreachValidationError) {
      return NextResponse.json({ error: "validationFailed", field: e.field }, { status: 422 })
    }
    return mapErrorToResponse(e, "admin/data-breaches POST", ctx.requestId)
  }
}
