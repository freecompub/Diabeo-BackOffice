import { NextResponse, type NextRequest } from "next/server"
import { requireRole, AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { prisma } from "@/lib/db/client"
import { adjustmentService } from "@/lib/services/adjustment.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { logger } from "@/lib/logger"

type RouteParams = { params: Promise<{ id: string }> }

/** PATCH /api/adjustment-proposals/:id/reject — reject proposal (DOCTOR only + access control) */
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

    const ctx = extractRequestContext(req)
    const result = await adjustmentService.reject(id, user.id, ctx)
    const { notified } = await adjustmentService.notifyPatient(result.patientId, user.id, "rejected", ctx)
    return NextResponse.json({ ...result, notified })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    if (error instanceof Error && error.message === "proposalNotFound") {
      return NextResponse.json({ error: "proposalNotFound" }, { status: 404 })
    }
    logger.error("proposals/reject", "Reject failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
