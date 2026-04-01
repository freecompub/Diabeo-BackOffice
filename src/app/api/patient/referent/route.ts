import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole, AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { healthcareService } from "@/lib/services/healthcare.service"
import { extractRequestContext } from "@/lib/services/audit.service"

const referentSchema = z.object({
  patientId: z.number().int().positive(),
  proId: z.number().int().positive(),
  serviceId: z.number().int().positive(),
})

/** PUT /api/patient/referent — set referent doctor (DOCTOR only + access control) */
export async function PUT(req: NextRequest) {
  try {
    const user = requireRole(req, "DOCTOR")
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })

    const body = await req.json()
    const parsed = referentSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed", details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }

    const allowed = await canAccessPatient(user.id, user.role, parsed.data.patientId)
    if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 })

    const ctx = extractRequestContext(req)
    const result = await healthcareService.setReferent(
      parsed.data.patientId, parsed.data.proId, parsed.data.serviceId, user.id, ctx,
    )
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    if (error instanceof Error && error.message === "proNotFound") {
      return NextResponse.json({ error: "proNotFound" }, { status: 404 })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[patient/referent PUT]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
