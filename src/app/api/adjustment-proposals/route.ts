import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth, AuthError } from "@/lib/auth"
import { resolvePatientId, viewerProposalSources } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { adjustmentService } from "@/lib/services/adjustment.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"

const querySchema = z.object({
  patientId: z.coerce.number().int().positive().optional(),
  status: z.enum(["pending", "accepted", "rejected", "expired"]).optional(),
  parameterType: z.enum(["insulinSensitivityFactor", "insulinToCarbRatio", "basalRate"]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
})

export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })

    const params = Object.fromEntries(req.nextUrl.searchParams.entries())
    const parsed = querySchema.safeParse(params)
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed", details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }

    const ctx = extractRequestContext(req)
    const patientId = await resolvePatientId(user.id, user.role, parsed.data.patientId)
    if (!patientId) {
      // Sonde d'énumération (pro visant un patient hors portefeuille) → auditée (US-2265). Report US-2648a.
      if (parsed.data.patientId != null && user.role !== "VIEWER") {
        await auditService
          .accessDenied({ userId: user.id, resource: "PATIENT", resourceId: String(parsed.data.patientId), ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId, metadata: { patientId: parsed.data.patientId, kind: "adjustmentProposalList" } })
          .catch(() => {})
      }
      return NextResponse.json({ error: "patientNotFound" }, { status: 404 })
    }

    // Sûreté (medical, étape 1 vue unifiée) — le PATIENT (VIEWER) ne reçoit QUE ses propres demandes
    // (`source=patient`). Imposé SERVEUR (helper partagé avec `.../summary`), jamais depuis la query : voir
    // une dose non validée d'un soignant/l'algorithme l'exposerait à une auto-injection (ADR #13). Pros = tout.
    const proposals = await adjustmentService.list(patientId, { ...parsed.data, sources: viewerProposalSources(user.role) }, user.id, ctx)
    return NextResponse.json(proposals)
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[adjustment-proposals GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
