import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { Pathology } from "@prisma/client"
import { requireAuth, AuthError } from "@/lib/auth"
import { getOwnPatientId } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { patientService } from "@/lib/services/patient.service"

const updateSchema = z.object({
  pathology: z.nativeEnum(Pathology).optional(),
})

/** GET /api/patient — own patient profile */
export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req)

    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
    }

    const patientId = await getOwnPatientId(user.id)
    if (!patientId) {
      return NextResponse.json({ error: "patientNotFound" }, { status: 404 })
    }

    const patient = await patientService.getById(patientId, user.id)
    return NextResponse.json(patient)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[patient GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

/** PUT /api/patient — update own patient profile */
export async function PUT(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const patientId = await getOwnPatientId(user.id)

    if (!patientId) {
      return NextResponse.json({ error: "patientNotFound" }, { status: 404 })
    }

    const body = await req.json()
    const parsed = updateSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const result = await patientService.updateProfile(patientId, parsed.data, user.id)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[patient PUT]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
