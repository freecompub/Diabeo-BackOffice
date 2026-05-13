/** US-2083 — Approve / reject (review PR #390 C5 + H1). */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { delegationRequestService } from "@/lib/services/team-workflow.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

type RouteParams = { params: Promise<{ id: string }> }

const schema = z.object({
  status: z.enum(["approved", "rejected"]),
  reason: z.string().max(500).optional(),
})

export async function POST(req: NextRequest, { params }: RouteParams) {
  const ctx = extractRequestContext(req)
  try {
    const { id } = await params
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: "invalidId" }, { status: 400 })
    const user = await auditedRequireRole(req, "DOCTOR", ctx, "DELEGATION_REQUEST", id)
    const body = await req.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }
    const out = await delegationRequestService.respond(
      parseInt(id, 10), user.id, parsed.data, ctx,
    )
    return NextResponse.json(out)
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "team/delegations/:id/respond POST", ctx.requestId)
  }
}
