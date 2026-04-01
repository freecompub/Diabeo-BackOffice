import { NextResponse, type NextRequest } from "next/server"
import { requireRole, AuthError } from "@/lib/auth"
import { adjustmentService } from "@/lib/services/adjustment.service"
import { extractRequestContext } from "@/lib/services/audit.service"

type RouteParams = { params: Promise<{ id: string }> }

/** PATCH /api/adjustment-proposals/:id/reject — reject proposal (DOCTOR only) */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const user = requireRole(req, "DOCTOR")
    const { id } = await params

    const ctx = extractRequestContext(req)
    const result = await adjustmentService.reject(id, user.id, ctx)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    if (error instanceof Error && error.message === "proposalNotFound") {
      return NextResponse.json({ error: "proposalNotFound" }, { status: 404 })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[proposals/:id/reject PATCH]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
