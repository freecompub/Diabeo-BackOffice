/** US-2066 — Record real-world actualization of an AdjustmentProposal. */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole } from "@/lib/auth"
import { proposalActualizationService } from "@/lib/services/team-workflow.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { mapErrorToResponse } from "@/lib/team-route-helpers"

type RouteParams = { params: Promise<{ proposalId: string }> }

const schema = z.object({
  verifiedVia: z.enum(["device-sync", "manual-ps", "patient-confirmed"]),
  effectiveAt: z.coerce.date().optional(),
})

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const user = requireRole(req, "NURSE")
    const { proposalId } = await params
    const ctx = extractRequestContext(req)
    const body = await req.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }
    const row = await proposalActualizationService.record(
      proposalId, parsed.data, user.id, ctx,
    )
    return NextResponse.json(row, { status: 201 })
  } catch (e) {
    return mapErrorToResponse(e, "team/proposal-actualization POST")
  }
}
