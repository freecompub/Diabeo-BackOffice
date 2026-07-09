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
import { resolvePatientId } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { slotSetProposalService } from "@/lib/services/slot-set-proposal.service"
import { extractRequestContext } from "@/lib/services/audit.service"

const querySchema = z.object({
  patientId: z.coerce.number().int().positive().optional(),
  status: z.enum(["pending", "accepted", "rejected", "expired", "superseded"]).optional(),
})

export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })

    const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()))
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed", details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }

    const patientId = await resolvePatientId(user.id, user.role, parsed.data.patientId)
    if (!patientId) return NextResponse.json({ error: "patientNotFound" }, { status: 404 })

    const proposals = await slotSetProposalService.listSetProposals(patientId, user.id, parsed.data.status, extractRequestContext(req))
    return NextResponse.json(proposals)
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[slot-set-proposals GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
