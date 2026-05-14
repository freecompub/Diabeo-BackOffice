/** US-2123 H5 — Update / delete an allowed FHIR system (ADMIN). */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { fhirAllowedSystemService } from "@/lib/services/fhir-allowed-systems.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

type RouteParams = { params: Promise<{ id: string }> }

const updateSchema = z.object({
  label: z.string().min(1).max(200).optional(),
  dpaReference: z.string().min(1).max(500).optional(),
  isActive: z.boolean().optional(),
  killSwitchActive: z.boolean().optional(),
})

export async function PUT(req: NextRequest, { params }: RouteParams) {
  const ctx = extractRequestContext(req)
  try {
    const { id } = await params
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: "invalidId" }, { status: 400 })
    const user = await auditedRequireRole(req, "ADMIN", ctx, "FHIR_ALLOWED_SYSTEM", id)
    const body = await req.json()
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const out = await fhirAllowedSystemService.update(parseInt(id, 10), parsed.data, user.id, ctx)
    return NextResponse.json(out)
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "interop/fhir/allowed-systems PUT", ctx.requestId)
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const ctx = extractRequestContext(req)
  try {
    const { id } = await params
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: "invalidId" }, { status: 400 })
    const user = await auditedRequireRole(req, "ADMIN", ctx, "FHIR_ALLOWED_SYSTEM", id)
    const out = await fhirAllowedSystemService.deleteById(parseInt(id, 10), user.id, ctx)
    return NextResponse.json(out)
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "interop/fhir/allowed-systems DELETE", ctx.requestId)
  }
}
