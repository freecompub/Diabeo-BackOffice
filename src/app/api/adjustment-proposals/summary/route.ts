import { NextResponse, type NextRequest } from "next/server"
import { requireAuth, AuthError } from "@/lib/auth"
import { resolvePatientId, viewerProposalSources } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { adjustmentService } from "@/lib/services/adjustment.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"

/** GET /api/adjustment-proposals/summary — counts by status */
export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req)

    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })

    const ctx = extractRequestContext(req)
    const patientIdParam = req.nextUrl.searchParams.get("patientId")
    const attemptedId = patientIdParam ? parseInt(patientIdParam, 10) : undefined
    const patientId = await resolvePatientId(user.id, user.role, attemptedId)
    if (!patientId) {
      // Cohérence avec GET list — sonde d'énumération (pro visant un patient hors portefeuille) auditée
      // (US-2265) ; le summary est aussi une surface d'énumération de métadonnée. VIEWER/param absent = pas de sonde.
      if (attemptedId != null && user.role !== "VIEWER") {
        await auditService
          .accessDenied({ userId: user.id, resource: "PATIENT", resourceId: String(attemptedId), ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId, metadata: { patientId: attemptedId, kind: "adjustmentProposalSummary" } })
          .catch(() => {})
      }
      return NextResponse.json({ error: "patientNotFound" }, { status: 404 })
    }

    await auditService.log({
      userId: user.id,
      action: "READ",
      // US-2268 — summary agrégé par patient (pas un specific proposal).
      resource: "ADJUSTMENT_PROPOSAL",
      resourceId: String(patientId),
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { patientId, kind: "summary" },
    })

    // US-2664 (sûreté, cohérent avec GET list) — un PATIENT (VIEWER) ne compte QUE ses propres demandes
    // (`source=patient`). Sans ça, le compteur divulguerait l'existence de propositions non validées d'un
    // soignant/de l'algorithme (métadonnée). Helper partagé (même dérivation que la liste), imposé serveur.
    const summary = await adjustmentService.summary(patientId, viewerProposalSources(user.role))
    return NextResponse.json(summary)
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[adjustment-proposals/summary GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
