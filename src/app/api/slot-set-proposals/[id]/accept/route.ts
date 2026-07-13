/**
 * PATCH /api/slot-set-proposals/:id/accept — **ACCEPTE** une proposition d'ENSEMBLE de créneaux
 * (`SlotSetProposal`) : ISF/ICR, basale POMPE (`basalRate`, S3c) OU dose fixe (`fixedDose`, S3d). Acte MÉDECIN (US-2657 slice
 * C3d) : DOCTOR only (hiérarchique → ADMIN inclus) + contrôle d'accès patient (`canAccessPatient`, anti-IDOR).
 *
 * Flux : rate-limit (anti-abus) → lookup de la proposition (→ `patientId` + statut) → garde d'accès →
 * `acceptSetProposal` qui, dans UNE transaction, fait le compare-and-swap `pending → accepted` + applique le
 * jeu en bloc — routé par levier : `replaceSlotSet` (ISF/ICR) ou `replacePumpSlotSet` (POMPE) — avec verrou de
 * créneaux non bloquant, CAS d'ensemble, re-validation des bornes cliniques + frontière MDR + audite
 * `PROPOSAL_ACCEPTED` → **notification du patient soumissionnaire**.
 * Fail-closed : un échec clinique (bornes/couverture/non-insuliné) ou une course (rejet/supersede concurrent)
 * rollback tout → la proposition reste `pending`, aucune config appliquée sans acceptation valide.
 *
 * Traçabilité : les refus d'accès (403) sont audités (`accessDenied`, burst-detection US-2265). Mapping
 * erreurs : proposition absente/non pending → 404 ; échec clinique/MDR → 4xx via `SLOT_SET_ERROR_STATUS` ;
 * verrou occupé (`slotsBusy`) → 409 ; inattendu → 500 générique (sans fuite).
 */
import { NextResponse, type NextRequest } from "next/server"
import { requireRole, AuthError } from "@/lib/auth"
import { checkApiRateLimit, RATE_LIMITS } from "@/lib/auth/api-rate-limit"
import { canAccessPatient } from "@/lib/access-control"
import { prisma } from "@/lib/db/client"
import { slotSetProposalService } from "@/lib/services/slot-set-proposal.service"
import { adjustmentService } from "@/lib/services/adjustment.service"
import { SLOT_SET_ERROR_STATUS } from "@/lib/insulin/slot-set-errors"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { logger } from "@/lib/logger"

type RouteParams = { params: Promise<{ id: string }> }

/** Codes du service accept → HTTP : bornes/couverture/verrou/MDR (`SLOT_SET_ERROR_STATUS`) + spécifiques accept. */
const ACCEPT_ERROR_STATUS: Record<string, number> = {
  ...SLOT_SET_ERROR_STATUS,
  slotSetProposalNotFound: 404,
  // US-2663 (S3d, revue) — `unsupportedSlotSetParam` : levier non traitable par l'acceptation (invariant de
  // proposition stockée, pas une erreur d'input client) → 422 depuis `SLOT_SET_ERROR_STATUS` (source unique),
  // plus d'override 400 (divergence retirée).
  // US-2663 (S1) — CAS d'ensemble : la base a dérivé depuis la génération (`baselineMoved`) ou la proposition
  // legacy n'a pas de snapshot certifiable (`baselineMissing`) → 409 (conflit récupérable : régénérer/re-soumettre).
  baselineMoved: 409,
  baselineMissing: 409,
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const user = requireRole(req, "DOCTOR")
    const ctx = extractRequestContext(req)
    const { id } = await params

    // Rate-limit anti-abus (fail-open — dispo d'abord ; la confidentialité repose sur le RBAC).
    const rl = await checkApiRateLimit(String(user.id), RATE_LIMITS.insulinReview)
    if (!rl.allowed) {
      await auditService
        .rateLimited({ userId: user.id, resource: "SLOT_SET_PROPOSAL", resourceId: id, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId, metadata: { surface: "api", kind: "slotSetProposalAccept" } })
        .catch(() => {})
      return NextResponse.json({ error: "rateLimitExceeded" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } })
    }

    // Résout le patient de la proposition pour le contrôle d'accès (anti-IDOR). 404 neutre si absente/traitée.
    const proposal = await prisma.slotSetProposal.findUnique({ where: { id }, select: { patientId: true, status: true } })
    if (!proposal || proposal.status !== "pending") {
      return NextResponse.json({ error: "slotSetProposalNotFound" }, { status: 404 })
    }
    if (!(await canAccessPatient(user.id, user.role, proposal.patientId))) {
      // Refus d'accès sur acte de donnée de santé → audité (UNAUTHORIZED + burst-detection US-2265).
      await auditService
        .accessDenied({ userId: user.id, resource: "SLOT_SET_PROPOSAL", resourceId: id, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId, metadata: { patientId: proposal.patientId, kind: "slotSetProposalAccept" } })
        .catch(() => {})
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    const result = await slotSetProposalService.acceptSetProposal(id, proposal.patientId, user.id, ctx)
    // Le patient soumissionnaire est informé de la décision (parité avec la voie par-valeur remplacée).
    const { notified } = await adjustmentService.notifyPatient(proposal.patientId, user.id, "accepted", ctx)
    return NextResponse.json({ ...result, notified })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const status = error instanceof Error ? ACCEPT_ERROR_STATUS[error.message] : undefined
    if (status) return NextResponse.json({ error: (error as Error).message }, { status })
    logger.error("slot-set-proposals/accept", "Accept failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
