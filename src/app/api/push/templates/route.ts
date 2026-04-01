import { NextResponse, type NextRequest } from "next/server"
import { requireAuth, requireRole, AuthError } from "@/lib/auth"
import { pushService } from "@/lib/services/push.service"

/** GET /api/push/templates — list notification templates */
export async function GET(req: NextRequest) {
  try {
    requireAuth(req)
    const templates = await pushService.listTemplates()
    return NextResponse.json(templates)
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[push/templates GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
