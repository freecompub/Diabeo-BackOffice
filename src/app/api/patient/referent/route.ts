import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth, AuthError } from "@/lib/auth"
import { getOwnPatientId } from "@/lib/access-control"
import { healthcareService } from "@/lib/services/healthcare.service"

const referentSchema = z.object({
  proId: z.number().int().positive(),
  serviceId: z.number().int().positive(),
})

/** PUT /api/patient/referent — set referent doctor */
export async function PUT(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const patientId = await getOwnPatientId(user.id)
    if (!patientId) return NextResponse.json({ error: "patientNotFound" }, { status: 404 })

    const body = await req.json()
    const parsed = referentSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed", details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }

    const result = await healthcareService.setReferent(patientId, parsed.data.proId, parsed.data.serviceId, user.id)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[patient/referent PUT]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
