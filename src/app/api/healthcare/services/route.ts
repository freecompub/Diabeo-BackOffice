import { NextResponse, type NextRequest } from "next/server"
import { requireRole, AuthError } from "@/lib/auth"
import { healthcareService } from "@/lib/services/healthcare.service"
import { extractRequestContext } from "@/lib/services/audit.service"

/** GET /api/healthcare/services — list all services (NURSE+ only) */
export async function GET(req: NextRequest) {
  try {
    const user = requireRole(req, "NURSE")
    const ctx = extractRequestContext(req)
    const services = await healthcareService.listServices(user.id, ctx)
    return NextResponse.json(services)
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[healthcare/services GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
