/**
 * US-2065 — Patient acknowledgement / response on AdjustmentProposal.
 * Review PR #390 :
 *  - H2 : propagate `user.id` to the service (audit traceability).
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import type { Role } from "@prisma/client"
import { requireAuth, AuthError } from "@/lib/auth"
import { getOwnPatientId, viewerProposalSources } from "@/lib/access-control"
import { prisma } from "@/lib/db/client"
import { proposalAckService } from "@/lib/services/team-workflow.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { mapErrorToResponse } from "@/lib/team-route-helpers"

type RouteParams = { params: Promise<{ proposalId: string }> }

const respondSchema = z.object({
  accepted: z.boolean(),
  comment: z.string().max(500).optional(),
})

/**
 * Résout la proposition que l'appelant est autorisé à acquitter / à laquelle répondre.
 *
 * US-2665 — Frontière de provenance UNIFORME lecture ⇄ accusé : pour un `VIEWER` (patient),
 * on n'autorise QUE ses propres demandes (`source = 'patient'`, via `viewerProposalSources`) —
 * même règle que `GET /api/adjustment-proposals`. Sans ça, un patient connaissant l'UUID d'une
 * proposition `nurse`/`doctor`/`algorithm` de SON dossier pourrait l'acquitter (divulgation
 * d'existence d'une décision non validée — frontière MDR, ADR #13).
 *
 * Deux issues distinctes, l'une NON énumérante :
 *  - `{ status: 403 }` : l'appelant n'a pas de dossier patient propre (pro/ADMIN) — comportement
 *    INCHANGÉ (US-2665 AC-2 : `getOwnPatientId` renvoie `null` pour un non-patient).
 *  - `{ status: 404 }` : aucune proposition acquittable sous le filtre de provenance (tierce, d'un
 *    autre dossier, ou inexistante) — réponse IDENTIQUE dans les trois cas → aucune divulgation
 *    d'existence (US-2665 AC-1).
 */
async function resolveAckableProposal(proposalId: string, userId: number, role: Role) {
  const ownPatientId = await getOwnPatientId(userId)
  if (ownPatientId === null) return { status: 403 as const }
  const sources = viewerProposalSources(role)
  const proposal = await prisma.adjustmentProposal.findFirst({
    where: { id: proposalId, patientId: ownPatientId, ...(sources ? { source: { in: sources } } : {}) },
    select: { id: true, patientId: true },
  })
  if (!proposal) return { status: 404 as const }
  return { patientId: proposal.patientId }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const ctx = extractRequestContext(req)
  try {
    const user = requireAuth(req)
    const { proposalId } = await params
    const owned = await resolveAckableProposal(proposalId, user.id, user.role)
    if ("status" in owned) {
      return NextResponse.json({ error: owned.status === 404 ? "notFound" : "forbidden" }, { status: owned.status })
    }
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
    const owned = await resolveAckableProposal(proposalId, user.id, user.role)
    if ("status" in owned) {
      return NextResponse.json({ error: owned.status === 404 ? "notFound" : "forbidden" }, { status: owned.status })
    }
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
