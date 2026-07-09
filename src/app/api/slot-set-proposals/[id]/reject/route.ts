/**
 * PATCH /api/slot-set-proposals/:id/reject — **REJETTE** une proposition d'ENSEMBLE de créneaux ISF/ICR
 * (`SlotSetProposal`). Acte MÉDECIN (US-2657 slice C3d) : DOCTOR only (hiérarchique → ADMIN inclus) +
 * contrôle d'accès patient (`canAccessPatient`, anti-IDOR).
 *
 * Flux : lookup de la proposition (→ `patientId` + statut) → garde d'accès → `rejectSetProposal` qui flip
 * `pending → rejected` + audite `PROPOSAL_REJECTED` dans une transaction. Aucune config appliquée (rejet pur).
 * Proposition absente/non pending → 404 ; inattendu → 500 générique (sans fuite).
 */
import { NextResponse, type NextRequest } from "next/server"
import { requireRole, AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { prisma } from "@/lib/db/client"
import { slotSetProposalService } from "@/lib/services/slot-set-proposal.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { logger } from "@/lib/logger"

type RouteParams = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const user = requireRole(req, "DOCTOR")
    const { id } = await params

    const proposal = await prisma.slotSetProposal.findUnique({ where: { id }, select: { patientId: true, status: true } })
    if (!proposal || proposal.status !== "pending") {
      return NextResponse.json({ error: "slotSetProposalNotFound" }, { status: 404 })
    }
    if (!(await canAccessPatient(user.id, user.role, proposal.patientId))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    const result = await slotSetProposalService.rejectSetProposal(id, proposal.patientId, user.id, extractRequestContext(req))
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    if (error instanceof Error && error.message === "slotSetProposalNotFound") {
      return NextResponse.json({ error: "slotSetProposalNotFound" }, { status: 404 })
    }
    logger.error("slot-set-proposals/reject", "Reject failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
