/** US-2078 — Templates de messages (cabinet-scoped). */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole } from "@/lib/auth"
import { messageTemplateService } from "@/lib/services/team-workflow.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { mapErrorToResponse } from "@/lib/team-route-helpers"

const querySchema = z.object({ serviceId: z.coerce.number().int().positive() })
const createSchema = z.object({
  serviceId: z.number().int().positive(),
  title: z.string().trim().min(1).max(120),
  body: z.string().min(1).max(4096),
  variables: z.array(z.string().min(1).max(40)).max(20).optional(),
})

export async function GET(req: NextRequest) {
  try {
    const user = requireRole(req, "NURSE")
    const ctx = extractRequestContext(req)
    const parsed = querySchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams.entries()),
    )
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }
    const items = await messageTemplateService.list(parsed.data.serviceId, user.id, ctx)
    return NextResponse.json({ items })
  } catch (e) {
    return mapErrorToResponse(e, "team/templates GET")
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
    const tpl = await messageTemplateService.create(parsed.data, user.id, ctx)
    return NextResponse.json(tpl, { status: 201 })
  } catch (e) {
    return mapErrorToResponse(e, "team/templates POST")
  }
}
