/**
 * PATCH /api/slot-set-proposals/:id/reject — **REJETTE** une proposition d'ENSEMBLE de créneaux ISF/ICR
 * (`SlotSetProposal`). Acte MÉDECIN (US-2657 slice C3d) : DOCTOR only (hiérarchique → ADMIN inclus) +
 * contrôle d'accès patient (`canAccessPatient`, anti-IDOR).
 *
 * Flux : rate-limit → lookup (→ `patientId` + statut) → garde d'accès → `rejectSetProposal` (flip
 * `pending → rejected` + audit `PROPOSAL_REJECTED`, aucune config appliquée) → **notification du patient**.
 * Refus d'accès (403) audité (`accessDenied`, burst-detection US-2265). Proposition absente/non pending → 404 ;
 * inattendu → 500 générique (sans fuite).
 */
import { NextResponse, type NextRequest } from "next/server"
import { requireRole, AuthError } from "@/lib/auth"
import { checkApiRateLimit, RATE_LIMITS } from "@/lib/auth/api-rate-limit"
import { canAccessPatient } from "@/lib/access-control"
import { prisma } from "@/lib/db/client"
import { slotSetProposalService } from "@/lib/services/slot-set-proposal.service"
import { adjustmentService } from "@/lib/services/adjustment.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { logger } from "@/lib/logger"

type RouteParams = { params: Promise<{ id: string }> }

/** Codes du service reject → HTTP (reject ne touche aucune config : seul `slotSetProposalNotFound` remonte). */
const REJECT_ERROR_STATUS: Record<string, number> = {
  slotSetProposalNotFound: 404,
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const user = requireRole(req, "DOCTOR")
    const ctx = extractRequestContext(req)
    const { id } = await params

    const rl = await checkApiRateLimit(String(user.id), RATE_LIMITS.insulinReview)
    if (!rl.allowed) {
      await auditService
        .rateLimited({ userId: user.id, resource: "SLOT_SET_PROPOSAL", resourceId: id, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId, metadata: { surface: "api", kind: "slotSetProposalReject" } })
        .catch(() => {})
      return NextResponse.json({ error: "rateLimitExceeded" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } })
    }

    const proposal = await prisma.slotSetProposal.findUnique({ where: { id }, select: { patientId: true, status: true } })
    if (!proposal || proposal.status !== "pending") {
      return NextResponse.json({ error: "slotSetProposalNotFound" }, { status: 404 })
    }
    if (!(await canAccessPatient(user.id, user.role, proposal.patientId))) {
      await auditService
        .accessDenied({ userId: user.id, resource: "SLOT_SET_PROPOSAL", resourceId: id, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId, metadata: { patientId: proposal.patientId, kind: "slotSetProposalReject" } })
        .catch(() => {})
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    const result = await slotSetProposalService.rejectSetProposal(id, proposal.patientId, user.id, ctx)
    const { notified } = await adjustmentService.notifyPatient(proposal.patientId, user.id, "rejected", ctx)
    return NextResponse.json({ ...result, notified })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const status = error instanceof Error ? REJECT_ERROR_STATUS[error.message] : undefined
    if (status) return NextResponse.json({ error: (error as Error).message }, { status })
    logger.error("slot-set-proposals/reject", "Reject failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
