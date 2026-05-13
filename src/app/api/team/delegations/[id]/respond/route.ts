/** US-2083 — Approve / reject a delegation request (target DOCTOR only). */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole } from "@/lib/auth"
import { delegationRequestService } from "@/lib/services/team-workflow.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { mapErrorToResponse } from "@/lib/team-route-helpers"

type RouteParams = { params: Promise<{ id: string }> }

const schema = z.object({
  status: z.enum(["approved", "rejected"]),
  reason: z.string().max(500).optional(),
})

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const user = requireRole(req, "DOCTOR")
    const { id } = await params
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: "invalidId" }, { status: 400 })
    const ctx = extractRequestContext(req)
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
    return mapErrorToResponse(e, "team/delegations/:id/respond POST")
  }
}
