/** US-2503 — Doctor proposes an alternative date/hour after cancellation. */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { rdvAppointmentService } from "@/lib/services/rdv.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

type RouteParams = { params: Promise<{ id: string }> }
const schema = z.object({ alternativeAt: z.coerce.date() })

export async function POST(req: NextRequest, { params }: RouteParams) {
  const ctx = extractRequestContext(req)
  try {
    const { id } = await params
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: "invalidId" }, { status: 400 })
    const apptId = parseInt(id, 10)
    const user = await auditedRequireRole(req, "DOCTOR", ctx, "APPOINTMENT", id)

    const patientId = await rdvAppointmentService.getPatientIdFor(apptId)
    if (patientId === null) return NextResponse.json({ error: "notFound" }, { status: 404 })
    const allowed = await canAccessPatient(user.id, user.role, patientId)
    if (!allowed) {
      await auditService.accessDenied({
        userId: user.id, resource: "APPOINTMENT", resourceId: id,
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        metadata: { patientId, endpoint: "propose-alternative" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    const body = await req.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    const out = await rdvAppointmentService.proposeAlternative(apptId, parsed.data.alternativeAt, user.id, ctx)
    return NextResponse.json(out)
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "appointments/:id/propose-alternative POST", ctx.requestId)
  }
}
