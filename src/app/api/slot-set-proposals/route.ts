/**
 * GET /api/slot-set-proposals — liste les **propositions d'ENSEMBLE de créneaux** (`SlotSetProposal`) d'un
 * patient (US-2657 slice C3d). Vue médecin de revue ; un patient (VIEWER) voit ses propres propositions.
 *
 * Accès résolu par `resolvePatientId` (VIEWER → propre dossier ; pro → `patientId` explicite + portefeuille,
 * anti-IDOR → 404 neutre). Consentement RGPD requis. Lecture santé (valeurs de config) → auditée par le service.
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth, AuthError } from "@/lib/auth"
import { checkApiRateLimit, RATE_LIMITS } from "@/lib/auth/api-rate-limit"
import { resolvePatientId } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { slotSetProposalService } from "@/lib/services/slot-set-proposal.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { logger } from "@/lib/logger"

const querySchema = z.object({
  patientId: z.coerce.number().int().positive().optional(),
  status: z.enum(["pending", "accepted", "rejected", "expired", "superseded"]).optional(),
})

export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const ctx = extractRequestContext(req)

    // Rate-limit anti-abus : borne le spam de liste (bruit d'audit / charge DB) + le sondage d'ids. Fail-open.
    const rl = await checkApiRateLimit(String(user.id), RATE_LIMITS.insulinReview)
    if (!rl.allowed) {
      await auditService
        .rateLimited({ userId: user.id, resource: "SLOT_SET_PROPOSAL", resourceId: "list", ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId, metadata: { surface: "api", kind: "slotSetProposalList" } })
        .catch(() => {})
      return NextResponse.json({ error: "rateLimitExceeded" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } })
    }

    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })

    const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()))
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed", details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }

    const patientId = await resolvePatientId(user.id, user.role, parsed.data.patientId)
    if (!patientId) {
      // Un pro qui fournit un `patientId` hors périmètre est refusé par `resolvePatientId` (null) → sonde
      // d'énumération auditée (burst-detection US-2265). Le cas VIEWER/param absent ne déclenche pas d'audit.
      if (parsed.data.patientId != null) {
        await auditService
          .accessDenied({ userId: user.id, resource: "SLOT_SET_PROPOSAL", resourceId: String(parsed.data.patientId), ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId, metadata: { patientId: parsed.data.patientId, kind: "slotSetProposalList" } })
          .catch(() => {})
      }
      return NextResponse.json({ error: "patientNotFound" }, { status: 404 })
    }

    const proposals = await slotSetProposalService.listSetProposals(patientId, user.id, parsed.data.status, ctx)
    return NextResponse.json(proposals)
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    logger.error("slot-set-proposals/list", "List failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
