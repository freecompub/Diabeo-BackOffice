/**
 * US-2065 — Patient acknowledgement / response on AdjustmentProposal.
 * Review PR #390 :
 *  - H2 : propagate `user.id` to the service (audit traceability).
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth, AuthError } from "@/lib/auth"
import { getOwnPatientId } from "@/lib/access-control"
import { prisma } from "@/lib/db/client"
import { proposalAckService } from "@/lib/services/team-workflow.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { mapErrorToResponse } from "@/lib/team-route-helpers"

type RouteParams = { params: Promise<{ proposalId: string }> }

const respondSchema = z.object({
  accepted: z.boolean(),
  comment: z.string().max(500).optional(),
})

async function ensureProposalOwnership(proposalId: string, userId: number) {
  const ownPatientId = await getOwnPatientId(userId)
  if (ownPatientId === null) return null
  const proposal = await prisma.adjustmentProposal.findFirst({
    where: { id: proposalId, patientId: ownPatientId },
    select: { id: true, patientId: true },
  })
  return proposal
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const ctx = extractRequestContext(req)
  try {
    const user = requireAuth(req)
    const { proposalId } = await params
    const owned = await ensureProposalOwnership(proposalId, user.id)
    if (!owned) return NextResponse.json({ error: "forbidden" }, { status: 403 })
    const ack = await proposalAckService.markRead(proposalId, owned.patientId, user.id, ctx)
    return NextResponse.json({ id: ack.id, readAt: ack.readAt })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "team/proposal-ack POST", ctx.requestId)
  }
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  const ctx = extractRequestContext(req)
  try {
    const user = requireAuth(req)
    const { proposalId } = await params
    const owned = await ensureProposalOwnership(proposalId, user.id)
    if (!owned) return NextResponse.json({ error: "forbidden" }, { status: 403 })
    const body = await req.json()
    const parsed = respondSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }
    const ack = await proposalAckService.respond(
      proposalId, owned.patientId, parsed.data, user.id, ctx,
    )
    return NextResponse.json({ id: ack.id, accepted: ack.accepted, respondedAt: ack.respondedAt })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "team/proposal-ack PUT", ctx.requestId)
  }
}
