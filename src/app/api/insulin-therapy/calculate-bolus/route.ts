import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth, AuthError } from "@/lib/auth"
import { resolvePatientId } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { insulinService, InvalidTherapyConfigError } from "@/lib/services/insulin.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { logger } from "@/lib/logger"

const bolusSchema = z.object({
  patientId: z.number().int().positive().optional(),
  currentGlucoseGl: z.number().min(0.20).max(6.00),
  carbsGrams: z.number().min(0).max(500),
})

export async function POST(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })

    const body = await req.json()
    const parsed = bolusSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed", details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }

    const { patientId: pidParam, ...bolusInput } = parsed.data
    const patientId = await resolvePatientId(user.id, user.role, pidParam)
    if (!patientId) return NextResponse.json({ error: "patientNotFound" }, { status: 404 })

    const result = await insulinService.calculateBolus(
      { patientId, ...bolusInput },
      user.id,
    )

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    if (error instanceof InvalidTherapyConfigError) {
      // 422 Unprocessable Entity — config is malformed (data-integrity), not a
      // user-input issue. Opaque error code, no message leak.
      return NextResponse.json({ error: error.code }, { status: 422 })
    }
    const ctx = extractRequestContext(req)
    logger.error("insulin/calculate-bolus", "bolus handler failed", { requestId: ctx.requestId }, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
