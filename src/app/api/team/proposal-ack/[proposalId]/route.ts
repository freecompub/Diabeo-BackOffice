/**
 * US-2065 — Patient acknowledgement / response on an AdjustmentProposal.
 *
 * `POST` marks read; `PUT` records accept/reject decision with optional
 * comment (encrypted). Caller must be the patient (VIEWER) — RBAC + audit
 * trail enforced.
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth } from "@/lib/auth"
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
  try {
    const user = requireAuth(req)
    const { proposalId } = await params
    const ctx = extractRequestContext(req)
    const owned = await ensureProposalOwnership(proposalId, user.id)
    if (!owned) return NextResponse.json({ error: "forbidden" }, { status: 403 })
    const ack = await proposalAckService.markRead(proposalId, owned.patientId, ctx)
    return NextResponse.json({ id: ack.id, readAt: ack.readAt })
  } catch (e) {
    return mapErrorToResponse(e, "team/proposal-ack POST")
  }
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const user = requireAuth(req)
    const { proposalId } = await params
    const ctx = extractRequestContext(req)
    const owned = await ensureProposalOwnership(proposalId, user.id)
    if (!owned) return NextResponse.json({ error: "forbidden" }, { status: 403 })
    const body = await req.json()
    const parsed = respondSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }
    const ack = await proposalAckService.respond(
      proposalId, owned.patientId, parsed.data, ctx,
    )
    return NextResponse.json({ id: ack.id, accepted: ack.accepted, respondedAt: ack.respondedAt })
  } catch (e) {
    return mapErrorToResponse(e, "team/proposal-ack PUT")
  }
}
