/** US-2066 — Real-world actualization (review PR #390 C4 + H4). */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { patientShareConsent } from "@/lib/consent"
import { proposalActualizationService } from "@/lib/services/team-workflow.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

type RouteParams = { params: Promise<{ proposalId: string }> }

const schema = z.object({
  verifiedVia: z.enum(["device-sync", "manual-ps", "patient-confirmed"]),
  effectiveAt: z.coerce.date().optional(),
})

const PROPOSAL_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: NextRequest, { params }: RouteParams) {
  const ctx = extractRequestContext(req)
  try {
    const { proposalId } = await params
    if (!PROPOSAL_ID_RE.test(proposalId)) {
      return NextResponse.json({ error: "invalidProposalId" }, { status: 400 })
    }
    const user = await auditedRequireRole(req, "NURSE", ctx, "PROPOSAL_ACTUALIZATION", proposalId)

    // C4 — verify access to the patient owning the proposal.
    const patientId = await proposalActualizationService.getProposalPatientId(proposalId)
    if (patientId === null) {
      return NextResponse.json({ error: "proposalNotFound" }, { status: 404 })
    }
    const allowed = await canAccessPatient(user.id, user.role, patientId)
    if (!allowed) {
      await auditService.accessDenied({
        userId: user.id, resource: "PROPOSAL_ACTUALIZATION",
        resourceId: proposalId,
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        metadata: { patientId, proposalId, endpoint: "record" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    const consent = await patientShareConsent(patientId)
    if (!consent.ok) return NextResponse.json({ error: consent.error }, { status: consent.status })

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
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "team/proposal-actualization POST", ctx.requestId)
  }
}
