import { NextResponse, type NextRequest } from "next/server"
import { requireAuth, AuthError } from "@/lib/auth"
import { resolvePatientId } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { adjustmentService } from "@/lib/services/adjustment.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"

/** GET /api/adjustment-proposals/summary — counts by status */
export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req)

    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })

    const patientIdParam = req.nextUrl.searchParams.get("patientId")
    const patientId = await resolvePatientId(user.id, user.role, patientIdParam ? parseInt(patientIdParam, 10) : undefined)
    if (!patientId) return NextResponse.json({ error: "patientNotFound" }, { status: 404 })

    const ctx = extractRequestContext(req)
    await auditService.log({
      userId: user.id,
      action: "READ",
      resource: "ADJUSTMENT_PROPOSAL",
      resourceId: `${patientId}:summary`,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })

    const summary = await adjustmentService.summary(patientId)
    return NextResponse.json(summary)
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[adjustment-proposals/summary GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
