/** US-2116 — Update / delete a healthcare regulation by id (ADMIN). */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { healthcareRegulationService } from "@/lib/services/country-config.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

type RouteParams = { params: Promise<{ id: string }> }

const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  rule: z.string().min(1).max(50_000).optional(),
  references: z.string().max(10_000).nullable().optional(),
  enforcedUntil: z.coerce.date().nullable().optional(),
  isActive: z.boolean().optional(),
})

export async function PUT(req: NextRequest, { params }: RouteParams) {
  const ctx = extractRequestContext(req)
  try {
    const { id } = await params
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: "invalidId" }, { status: 400 })
    const user = await auditedRequireRole(req, "ADMIN", ctx, "HEALTHCARE_REGULATION", id)
    const body = await req.json()
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const out = await healthcareRegulationService.update(parseInt(id, 10), parsed.data, user.id, ctx)
    return NextResponse.json(out)
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "config/regulations PUT", ctx.requestId)
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const ctx = extractRequestContext(req)
  try {
    const { id } = await params
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: "invalidId" }, { status: 400 })
    const user = await auditedRequireRole(req, "ADMIN", ctx, "HEALTHCARE_REGULATION", id)
    const out = await healthcareRegulationService.deleteById(parseInt(id, 10), user.id, ctx)
    return NextResponse.json(out)
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "config/regulations DELETE", ctx.requestId)
  }
}
