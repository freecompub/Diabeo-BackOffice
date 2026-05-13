/** US-2088 — Groupes patients (review PR #390 H1). */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { patientGroupService } from "@/lib/services/team-workflow.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

const querySchema = z.object({ serviceId: z.coerce.number().int().positive() })
const createSchema = z.object({
  serviceId: z.number().int().positive(),
  label: z.string().trim().min(1).max(80),
})

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const parsed = querySchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams.entries()),
    )
    if (!parsed.success) return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    const user = await auditedRequireRole(req, "NURSE", ctx, "PATIENT_GROUP", String(parsed.data.serviceId))
    const items = await patientGroupService.listForService(parsed.data.serviceId, user.id, ctx)
    return NextResponse.json({ items })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "team/groups GET", ctx.requestId)
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
    const user = await auditedRequireRole(req, "DOCTOR", ctx, "PATIENT_GROUP", String(parsed.data.serviceId))
    const g = await patientGroupService.create(parsed.data, user.id, ctx)
    return NextResponse.json(g, { status: 201 })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "team/groups POST", ctx.requestId)
  }
}
