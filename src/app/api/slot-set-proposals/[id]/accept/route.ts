/**
 * PATCH /api/slot-set-proposals/:id/accept — **ACCEPTE** une proposition d'ENSEMBLE de créneaux ISF/ICR
 * (`SlotSetProposal`). Acte MÉDECIN (US-2657 slice C3d) : DOCTOR only (hiérarchique → ADMIN inclus) +
 * contrôle d'accès patient (`canAccessPatient`, anti-IDOR).
 *
 * Flux : lookup de la proposition (→ `patientId` + statut) → garde d'accès → `acceptSetProposal` qui, dans
 * UNE transaction, fait le compare-and-swap `pending → accepted` + applique le jeu en bloc (`replaceSlotSet`,
 * verrou de créneaux non bloquant, re-validation des bornes cliniques) + audite `PROPOSAL_ACCEPTED`.
 * Fail-closed : un échec clinique (bornes/couverture) ou une course (rejet/supersede concurrent) rollback tout
 * → la proposition reste `pending`, aucune config appliquée sans acceptation valide.
 *
 * Mapping erreurs : proposition absente/non pending → 404 ; échec clinique (bornes/couverture) → 4xx via
 * `SLOT_SET_ERROR_STATUS` ; verrou occupé (`slotsBusy`) → 409 ; inattendu → 500 générique (sans fuite).
 */
import { NextResponse, type NextRequest } from "next/server"
import { requireRole, AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { prisma } from "@/lib/db/client"
import { slotSetProposalService } from "@/lib/services/slot-set-proposal.service"
import { SLOT_SET_ERROR_STATUS } from "@/lib/insulin/slot-set-errors"
import { extractRequestContext } from "@/lib/services/audit.service"
import { logger } from "@/lib/logger"

type RouteParams = { params: Promise<{ id: string }> }

/** Codes du service accept → HTTP : bornes/couverture/verrou (`SLOT_SET_ERROR_STATUS`) + spécifiques accept. */
const ACCEPT_ERROR_STATUS: Record<string, number> = {
  ...SLOT_SET_ERROR_STATUS,
  slotSetProposalNotFound: 404,
  unsupportedSlotSetParam: 400,
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const user = requireRole(req, "DOCTOR")
    const { id } = await params

    // Résout le patient de la proposition pour le contrôle d'accès (anti-IDOR). 404 neutre si absente/traitée.
    const proposal = await prisma.slotSetProposal.findUnique({ where: { id }, select: { patientId: true, status: true } })
    if (!proposal || proposal.status !== "pending") {
      return NextResponse.json({ error: "slotSetProposalNotFound" }, { status: 404 })
    }
    if (!(await canAccessPatient(user.id, user.role, proposal.patientId))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    const result = await slotSetProposalService.acceptSetProposal(id, proposal.patientId, user.id, extractRequestContext(req))
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const status = error instanceof Error ? ACCEPT_ERROR_STATUS[error.message] : undefined
    if (status) return NextResponse.json({ error: (error as Error).message }, { status })
    logger.error("slot-set-proposals/accept", "Accept failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
