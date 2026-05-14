/** US-2503 — Patient accepts the alternative proposed by the doctor. */

import { NextResponse, type NextRequest } from "next/server"
import { AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { rdvAppointmentService } from "@/lib/services/rdv.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: RouteParams) {
  const ctx = extractRequestContext(req)
  try {
    const { id } = await params
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: "invalidId" }, { status: 400 })
    const apptId = parseInt(id, 10)
    const user = await auditedRequireRole(req, "NURSE", ctx, "APPOINTMENT", id)

    const patientId = await rdvAppointmentService.getPatientIdFor(apptId)
    if (patientId === null) return NextResponse.json({ error: "notFound" }, { status: 404 })
    const allowed = await canAccessPatient(user.id, user.role, patientId)
    if (!allowed) {
      await auditService.accessDenied({
        userId: user.id, resource: "APPOINTMENT", resourceId: id,
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        metadata: { patientId, endpoint: "accept-alternative" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    const out = await rdvAppointmentService.acceptAlternative(apptId, user.id, ctx)
    return NextResponse.json(out)
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "appointments/:id/accept-alternative POST", ctx.requestId)
  }
}
