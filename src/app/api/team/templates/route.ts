/** US-2078 — Templates de messages (review PR #390 H1). */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { messageTemplateService } from "@/lib/services/team-workflow.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

const querySchema = z.object({ serviceId: z.coerce.number().int().positive() })
const createSchema = z.object({
  serviceId: z.number().int().positive(),
  title: z.string().trim().min(1).max(120),
  body: z.string().min(1).max(4096),
  variables: z.array(z.string().min(1).max(40)).max(20).optional(),
})

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const parsed = querySchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams.entries()),
    )
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }
    const user = await auditedRequireRole(req, "NURSE", ctx, "MESSAGE_TEMPLATE", String(parsed.data.serviceId))
    const items = await messageTemplateService.list(parsed.data.serviceId, user.id, ctx)
    return NextResponse.json({ items })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "team/templates GET", ctx.requestId)
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
    const user = await auditedRequireRole(req, "DOCTOR", ctx, "MESSAGE_TEMPLATE", String(parsed.data.serviceId))
    const tpl = await messageTemplateService.create(parsed.data, user.id, ctx)
    return NextResponse.json(tpl, { status: 201 })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "team/templates POST", ctx.requestId)
  }
}
