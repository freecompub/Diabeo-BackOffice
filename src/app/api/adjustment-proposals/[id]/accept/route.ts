import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole, AuthError } from "@/lib/auth"
import { adjustmentService } from "@/lib/services/adjustment.service"
import { extractRequestContext } from "@/lib/services/audit.service"

type RouteParams = { params: Promise<{ id: string }> }

const acceptSchema = z.object({
  applyImmediately: z.boolean().default(false),
})

/** PATCH /api/adjustment-proposals/:id/accept — accept proposal (DOCTOR only) */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const user = requireRole(req, "DOCTOR")
    const { id } = await params

    const body = await req.json()
    const parsed = acceptSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }

    const ctx = extractRequestContext(req)
    const result = await adjustmentService.accept(id, user.id, parsed.data.applyImmediately, ctx)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    if (error instanceof Error && error.message === "proposalNotFound") {
      return NextResponse.json({ error: "proposalNotFound" }, { status: 404 })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[proposals/:id/accept PATCH]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
