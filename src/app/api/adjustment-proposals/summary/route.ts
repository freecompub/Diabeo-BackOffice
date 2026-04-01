import { NextResponse, type NextRequest } from "next/server"
import { requireAuth, AuthError } from "@/lib/auth"
import { getOwnPatientId } from "@/lib/access-control"
import { adjustmentService } from "@/lib/services/adjustment.service"

/** GET /api/adjustment-proposals/summary — counts by status */
export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const patientId = await getOwnPatientId(user.id)
    if (!patientId) return NextResponse.json({ error: "patientNotFound" }, { status: 404 })

    const summary = await adjustmentService.summary(patientId)
    return NextResponse.json(summary)
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[adjustment-proposals/summary GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
