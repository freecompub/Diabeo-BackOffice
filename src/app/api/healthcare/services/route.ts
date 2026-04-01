import { NextResponse, type NextRequest } from "next/server"
import { requireAuth, AuthError } from "@/lib/auth"
import { healthcareService } from "@/lib/services/healthcare.service"

/** GET /api/healthcare/services — list all healthcare services */
export async function GET(req: NextRequest) {
  try {
    requireAuth(req)
    const services = await healthcareService.listServices()
    return NextResponse.json(services)
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[healthcare/services GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
