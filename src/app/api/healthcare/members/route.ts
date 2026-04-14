import { NextResponse, type NextRequest } from "next/server"
import { requireAuth, AuthError } from "@/lib/auth"
import { resolvePatientId } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { healthcareService } from "@/lib/services/healthcare.service"
import { extractRequestContext } from "@/lib/services/audit.service"

/** GET /api/healthcare/members — members of the patient's healthcare team */
export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })

    const pidParam = new URL(req.url).searchParams.get("patientId")
    const patientId = await resolvePatientId(
      user.id,
      user.role,
      pidParam ? parseInt(pidParam, 10) : undefined,
    )
    if (!patientId) return NextResponse.json({ error: "patientNotFound" }, { status: 404 })

    const ctx = extractRequestContext(req)
    const members = await healthcareService.getMembersForPatient(patientId, user.id, ctx)
    return NextResponse.json(members)
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[healthcare/members GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
