/** US-2505 — Doctor confirms a pending_validation appointment. */

import { NextResponse, type NextRequest } from "next/server"
import { AuthError } from "@/lib/auth"
import { rdvAppointmentService } from "@/lib/services/rdv.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { mapErrorToResponse } from "@/lib/team-route-helpers"
import {
  appointmentRouteGate,
  setAppointmentSecurityHeaders,
} from "@/lib/appointments-route-helpers"

type RouteParams = { params: Promise<{ id: string }> }

/** Fix HSA-2-2 round 2 review PR #433 — headers ANSSI sur retour PHI. */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const ctx = extractRequestContext(req)
  try {
    const { id } = await params
    const gate = await appointmentRouteGate(req, id, "DOCTOR", "confirm")
    if (gate.kind === "error") return setAppointmentSecurityHeaders(gate.res)

    const out = await rdvAppointmentService.confirm(gate.apptId, gate.user.id, ctx)
    return setAppointmentSecurityHeaders(NextResponse.json(out))
  } catch (e) {
    if (e instanceof AuthError) {
      return setAppointmentSecurityHeaders(
        NextResponse.json({ error: e.message }, { status: e.status }),
      )
    }
    return setAppointmentSecurityHeaders(
      mapErrorToResponse(e, "appointments/:id/confirm POST", ctx.requestId),
    )
  }
}
