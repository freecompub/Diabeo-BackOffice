import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth, requireRole, AuthError } from "@/lib/auth"
import { getOwnPatientId } from "@/lib/access-control"
import { objectivesService } from "@/lib/services/objectives.service"

/** GET /api/patient/objectives — read own objectives (all 3 types) */
export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const patientId = await getOwnPatientId(user.id)

    if (!patientId) {
      return NextResponse.json({ error: "patientNotFound" }, { status: 404 })
    }

    const objectives = await objectivesService.getAll(patientId, user.id)
    return NextResponse.json(objectives)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[patient/objectives GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

// --- CGM objectives update (DOCTOR only) ---

const cgmSchema = z.object({
  patientId: z.number().int().positive(),
  veryLow: z.number().min(0.30).max(1.00),
  low: z.number().min(0.40).max(1.50),
  ok: z.number().min(1.00).max(3.00),
  high: z.number().min(1.50).max(5.00),
  titrLow: z.number().min(0.40).max(1.50),
  titrHigh: z.number().min(1.00).max(3.00),
}).refine((d) => d.veryLow < d.low && d.low < d.ok && d.ok < d.high, {
  message: "Thresholds must be ordered: veryLow < low < ok < high",
}).refine((d) => d.titrLow < d.titrHigh, {
  message: "TIR thresholds must be ordered: titrLow < titrHigh",
})

/** PUT /api/patient/objectives — update CGM objectives (DOCTOR only) */
export async function PUT(req: NextRequest) {
  try {
    const user = requireRole(req, "DOCTOR")
    const body = await req.json()
    const parsed = cgmSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const { patientId, ...cgmInput } = parsed.data
    const result = await objectivesService.updateCgm(patientId, cgmInput, user.id)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[patient/objectives PUT]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
