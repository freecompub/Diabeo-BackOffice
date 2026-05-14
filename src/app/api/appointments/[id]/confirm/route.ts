/** US-2505 — Doctor confirms a pending_validation appointment. */

import { NextResponse, type NextRequest } from "next/server"
import { AuthError } from "@/lib/auth"
import { rdvAppointmentService } from "@/lib/services/rdv.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { mapErrorToResponse } from "@/lib/team-route-helpers"
import { appointmentRouteGate } from "@/lib/appointments-route-helpers"

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: RouteParams) {
  const ctx = extractRequestContext(req)
  try {
    const { id } = await params
    const gate = await appointmentRouteGate(req, id, "DOCTOR", "confirm")
    if (gate.kind === "error") return gate.res

    const out = await rdvAppointmentService.confirm(gate.apptId, gate.user.id, ctx)
    return NextResponse.json(out)
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "appointments/:id/confirm POST", ctx.requestId)
  }
}
