/** US-2088 — Groupes patients (cohortes cabinet). */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole } from "@/lib/auth"
import { patientGroupService } from "@/lib/services/team-workflow.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { mapErrorToResponse } from "@/lib/team-route-helpers"

const querySchema = z.object({ serviceId: z.coerce.number().int().positive() })
const createSchema = z.object({
  serviceId: z.number().int().positive(),
  label: z.string().trim().min(1).max(80),
})

export async function GET(req: NextRequest) {
  try {
    const user = requireRole(req, "NURSE")
    const ctx = extractRequestContext(req)
    const parsed = querySchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams.entries()),
    )
    if (!parsed.success) return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    const items = await patientGroupService.listForService(parsed.data.serviceId, user.id, ctx)
    return NextResponse.json({ items })
  } catch (e) {
    return mapErrorToResponse(e, "team/groups GET")
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = requireRole(req, "DOCTOR")
    const ctx = extractRequestContext(req)
    const body = await req.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const g = await patientGroupService.create(parsed.data, user.id, ctx)
    return NextResponse.json(g, { status: 201 })
  } catch (e) {
    return mapErrorToResponse(e, "team/groups POST")
  }
}
