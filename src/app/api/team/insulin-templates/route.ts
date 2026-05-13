/** US-2050 — Insulin adjustment templates (cabinet-scoped). */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { Pathology } from "@prisma/client"
import { AuthError } from "@/lib/auth"
import { insulinAdjustmentTemplateService } from "@/lib/services/insulin-meals.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

const querySchema = z.object({ serviceId: z.coerce.number().int().positive() })
const createSchema = z.object({
  serviceId: z.number().int().positive(),
  title: z.string().trim().min(1).max(120),
  parameter: z.enum(["BASAL", "ISF", "ICR"]),
  pathology: z.enum(Pathology).optional(),
  adjustments: z.record(z.string(), z.unknown()),
})

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const parsed = querySchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams.entries()),
    )
    if (!parsed.success) return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    const user = await auditedRequireRole(
      req, "NURSE", ctx, "INSULIN_ADJUSTMENT_TEMPLATE", String(parsed.data.serviceId),
    )
    const items = await insulinAdjustmentTemplateService.listForService(
      parsed.data.serviceId, user.id, ctx,
    )
    return NextResponse.json({ items })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "team/insulin-templates GET", ctx.requestId)
  }
}

export async function POST(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const body = await req.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const user = await auditedRequireRole(
      req, "DOCTOR", ctx, "INSULIN_ADJUSTMENT_TEMPLATE", String(parsed.data.serviceId),
    )
    const tpl = await insulinAdjustmentTemplateService.create(parsed.data, user.id, ctx)
    return NextResponse.json(tpl, { status: 201 })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "team/insulin-templates POST", ctx.requestId)
  }
}
