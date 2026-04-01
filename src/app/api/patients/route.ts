import { NextResponse, type NextRequest } from "next/server"
import { requireRole, AuthError } from "@/lib/auth"
import { patientService } from "@/lib/services/patient.service"
import { extractRequestContext } from "@/lib/services/audit.service"

/** GET /api/patients — list patients for the connected healthcare pro */
export async function GET(req: NextRequest) {
  try {
    const user = requireRole(req, "NURSE")
    const ctx = extractRequestContext(req)

    const patients = await patientService.listByDoctor(user.id, user.id)
    return NextResponse.json(patients)
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[patients GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
