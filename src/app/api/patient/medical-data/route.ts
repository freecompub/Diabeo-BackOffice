import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth, AuthError } from "@/lib/auth"
import { getOwnPatientId } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { patientService } from "@/lib/services/patient.service"

const updateMedicalSchema = z.object({
  dt1: z.boolean().optional(),
  size: z.number().min(30).max(250).optional(),
  yearDiag: z.number().int().min(1900).max(new Date().getFullYear()).optional(),
  insulin: z.boolean().optional(),
  insulinYear: z.number().int().min(1900).max(new Date().getFullYear()).optional(),
  insulinPump: z.boolean().optional(),
  pathology: z.string().max(500).optional(),
  diabetDiscovery: z.string().max(500).optional(),
  tabac: z.boolean().optional(),
  alcool: z.boolean().optional(),
  historyMedical: z.string().max(5000).optional(),
  historyChirurgical: z.string().max(5000).optional(),
  historyFamily: z.string().max(5000).optional(),
  historyAllergy: z.string().max(5000).optional(),
  historyVaccine: z.string().max(5000).optional(),
  historyLife: z.string().max(5000).optional(),
  riskWeight: z.boolean().optional(),
  riskTension: z.boolean().optional(),
  riskSedent: z.boolean().optional(),
  riskCholesterol: z.boolean().optional(),
  riskAge: z.boolean().optional(),
  riskHeredit: z.boolean().optional(),
})

/** GET /api/patient/medical-data — own medical data (decrypted) */
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

    const data = await patientService.getMedicalData(patientId, user.id)
    return NextResponse.json(data)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[patient/medical-data GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

/** PUT /api/patient/medical-data — update own medical data */
export async function PUT(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const patientId = await getOwnPatientId(user.id)

    if (!patientId) {
      return NextResponse.json({ error: "patientNotFound" }, { status: 404 })
    }

    const body = await req.json()
    const parsed = updateMedicalSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const result = await patientService.updateMedicalData(patientId, parsed.data, user.id)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[patient/medical-data PUT]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
