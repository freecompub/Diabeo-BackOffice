/** US-2503 — Patient accepts the alternative proposed by the doctor. */

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
    const gate = await appointmentRouteGate(req, id, "NURSE", "accept-alternative")
    if (gate.kind === "error") return gate.res

    const out = await rdvAppointmentService.acceptAlternative(
      gate.apptId, gate.user.id, ctx, gate.user.role,
    )
    return NextResponse.json(out)
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "appointments/:id/accept-alternative POST", ctx.requestId)
  }
}
