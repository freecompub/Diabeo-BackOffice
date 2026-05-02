import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole, AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { prisma } from "@/lib/db/client"
import { adjustmentService } from "@/lib/services/adjustment.service"
import { extractRequestContext } from "@/lib/services/audit.service"

type RouteParams = { params: Promise<{ id: string }> }

const acceptSchema = z.object({
  applyImmediately: z.boolean().default(false),
})

/** PATCH /api/adjustment-proposals/:id/accept — accept proposal (DOCTOR only + access control) */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const user = requireRole(req, "DOCTOR")
    const { id } = await params

    // Verify the doctor has access to this patient
    const proposal = await prisma.adjustmentProposal.findUnique({
      where: { id },
      select: { patientId: true, status: true },
    })
    if (!proposal || proposal.status !== "pending") {
      return NextResponse.json({ error: "proposalNotFound" }, { status: 404 })
    }

    const allowed = await canAccessPatient(user.id, user.role, proposal.patientId)
    if (!allowed) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    const body = await req.json()
    const parsed = acceptSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }

    const ctx = extractRequestContext(req)
    const result = await adjustmentService.accept(id, user.id, parsed.data.applyImmediately, ctx)
    adjustmentService.notifyPatient(result.patientId, user.id, "accepted", ctx)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    if (error instanceof Error && error.message === "proposalNotFound") {
      return NextResponse.json({ error: "proposalNotFound" }, { status: 404 })
    }
    if (error instanceof Error && error.message === "valueOutOfBounds") {
      return NextResponse.json({ error: "valueOutOfBounds" }, { status: 400 })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[proposals/:id/accept PATCH]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
