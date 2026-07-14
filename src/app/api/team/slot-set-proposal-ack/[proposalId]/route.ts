/**
 * US-2663 (S5/c4) — Accusé / réponse patient sur une SlotSetProposal (proposition GROUPÉE).
 *
 * Port grouped-only de `POST|PUT /api/team/proposal-ack/[proposalId]` (US-2065/2665) : la voie
 * d'écriture par-valeur `AdjustmentProposal` étant retirée (S5), l'accusé patient cible désormais
 * la disposition GROUPÉE. Décision produit D3 : 1 accusé = jeu entier (relation 1:1). La frontière
 * de provenance (H2 audit, filtre `source` VIEWER, 404 non-énumérant) est répliquée à l'identique.
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import type { Role } from "@prisma/client"
import { requireAuth, AuthError } from "@/lib/auth"
import { checkApiRateLimit, RATE_LIMITS } from "@/lib/auth/api-rate-limit"
import { getOwnPatientId, viewerProposalSources } from "@/lib/access-control"
import { prisma } from "@/lib/db/client"
import { slotSetProposalAckService } from "@/lib/services/team-workflow.service"
import { auditService, extractRequestContext, type AuditContext } from "@/lib/services/audit.service"
import { mapErrorToResponse } from "@/lib/team-route-helpers"

type RouteParams = { params: Promise<{ proposalId: string }> }

// Revue PR #749 (finding #6) — pré-validation du format UUID (parité route actualisation) : rejette
// une entrée malformée AVANT tout lookup (400 stable, non-énumérant).
const PROPOSAL_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Garde commune POST/PUT (revue PR #749, findings #6/#7) : format UUID + rate-limit anti-abus.
 * Retourne une `NextResponse` d'erreur si bloqué, sinon `null` (poursuite). Le rate-limit borne le
 * débit d'écriture patient (l'upsert 1:1 borne déjà le volume, ceci borne la FRÉQUENCE) ; fail-open,
 * saturation auditée (best-effort). `Retry-After` sur 429.
 */
async function ackGuard(proposalId: string, userId: number, ctx: AuditContext): Promise<NextResponse | null> {
  if (!PROPOSAL_ID_RE.test(proposalId)) {
    return NextResponse.json({ error: "invalidProposalId" }, { status: 400 })
  }
  const rl = await checkApiRateLimit(String(userId), RATE_LIMITS.insulinSubmission)
  if (!rl.allowed) {
    await auditService
      .rateLimited({ userId, resource: "PROPOSAL_ACK", resourceId: proposalId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId, metadata: { model: "slotSet", kind: "slotSetProposalAck" } })
      .catch(() => {})
    return NextResponse.json({ error: "rateLimitExceeded" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } })
  }
  return null
}

const respondSchema = z.object({
  accepted: z.boolean(),
  comment: z.string().max(500).optional(),
})

/**
 * Résout la SlotSetProposal que l'appelant est autorisé à acquitter / à laquelle répondre.
 *
 * Frontière de provenance UNIFORME (US-2665, portée au groupé) : pour un `VIEWER` (patient), on
 * n'autorise QUE ses propres demandes (`source = 'patient'`, via `viewerProposalSources`) — même
 * règle que `GET /api/slot-set-proposals`. Sans ça, un patient connaissant l'UUID d'une proposition
 * `nurse`/`doctor`/`algorithm` de SON dossier pourrait l'acquitter (divulgation d'existence d'une
 * décision non validée — frontière MDR, ADR #13).
 *
 * Deux issues distinctes, l'une NON énumérante :
 *  - `{ status: 403 }` : l'appelant n'a pas de dossier patient propre (pro/ADMIN).
 *  - `{ status: 404 }` : aucune proposition acquittable sous le filtre de provenance (tierce, autre
 *    dossier, ou inexistante) — réponse IDENTIQUE dans les trois cas → aucune divulgation d'existence.
 */
type AckDenied = { status: 403 } | { status: 404; ownPatientId: number }
type AckResolution = AckDenied | { status: 200; patientId: number }

async function resolveAckableProposal(proposalId: string, userId: number, role: Role): Promise<AckResolution> {
  const ownPatientId = await getOwnPatientId(userId)
  if (ownPatientId === null) return { status: 403 }
  const sources = viewerProposalSources(role)
  const proposal = await prisma.slotSetProposal.findFirst({
    where: { id: proposalId, patientId: ownPatientId, ...(sources ? { source: { in: sources } } : {}) },
    select: { id: true, patientId: true },
  })
  if (!proposal) return { status: 404, ownPatientId }
  return { status: 200, patientId: proposal.patientId }
}

/**
 * Réponse de refus, avec audit de la SONDE sur la branche 404 (parité US-2665, finding HDS LOW) :
 * une sonde d'UUID de proposition non acquittable laisse une trace SOC (burst-detection US-2265).
 * Fire-and-forget. Le 403 (pas de dossier patient propre) n'est PAS une sonde tierce → non audité.
 */
function denyAckResponse(
  owned: AckDenied,
  proposalId: string,
  userId: number,
  ctx: AuditContext,
): NextResponse {
  if (owned.status === 404) {
    auditService
      .accessDenied({
        userId,
        resource: "PROPOSAL_ACK",
        resourceId: proposalId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
        metadata: { patientId: owned.ownPatientId, model: "slotSet", kind: "slotSetProposalAckDenied" },
      })
      .catch(() => {})
    return NextResponse.json({ error: "notFound" }, { status: 404 })
  }
  return NextResponse.json({ error: "forbidden" }, { status: 403 })
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const ctx = extractRequestContext(req)
  try {
    const user = requireAuth(req)
    const { proposalId } = await params
    const blocked = await ackGuard(proposalId, user.id, ctx)
    if (blocked) return blocked
    const owned = await resolveAckableProposal(proposalId, user.id, user.role)
    if (owned.status !== 200) return denyAckResponse(owned, proposalId, user.id, ctx)
    const ack = await slotSetProposalAckService.markRead(proposalId, owned.patientId, user.id, ctx)
    return NextResponse.json({ id: ack.id, readAt: ack.readAt })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "team/slot-set-proposal-ack POST", ctx.requestId)
  }
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  const ctx = extractRequestContext(req)
  try {
    const user = requireAuth(req)
    const { proposalId } = await params
    const blocked = await ackGuard(proposalId, user.id, ctx)
    if (blocked) return blocked
    const owned = await resolveAckableProposal(proposalId, user.id, user.role)
    if (owned.status !== 200) return denyAckResponse(owned, proposalId, user.id, ctx)
    const body = await req.json()
    const parsed = respondSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }
    const ack = await slotSetProposalAckService.respond(
      proposalId, owned.patientId, parsed.data, user.id, ctx,
    )
    return NextResponse.json({ id: ack.id, accepted: ack.accepted, respondedAt: ack.respondedAt })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "team/slot-set-proposal-ack PUT", ctx.requestId)
  }
}
