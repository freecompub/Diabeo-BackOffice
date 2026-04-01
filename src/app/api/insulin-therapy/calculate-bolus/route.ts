import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth, AuthError } from "@/lib/auth"
import { getOwnPatientId } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { insulinService } from "@/lib/services/insulin.service"
import { extractRequestContext } from "@/lib/services/audit.service"

const bolusSchema = z.object({
  currentGlucoseGl: z.number().min(0.20).max(6.00),
  carbsGrams: z.number().min(0).max(500),
})

/** POST /api/insulin-therapy/calculate-bolus — calculate and log bolus */
export async function POST(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })

    const patientId = await getOwnPatientId(user.id)
    if (!patientId) return NextResponse.json({ error: "patientNotFound" }, { status: 404 })

    const body = await req.json()
    const parsed = bolusSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed", details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }

    const result = await insulinService.calculateBolus(
      { patientId, ...parsed.data },
      user.id,
    )

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[calculate-bolus POST]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
