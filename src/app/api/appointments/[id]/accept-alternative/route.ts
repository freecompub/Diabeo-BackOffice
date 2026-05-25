/** US-2503 — Patient accepts the alternative proposed by the doctor. */

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
    // PR #438 B2 — VIEWER (patient) accepte sa propre alternative depuis l'UI
    // /patient/appointments. Helper enforce ownership via canAccessPatient
    // (branche VIEWER → own patient uniquement). NURSE+ peut aussi accepter
    // au nom du patient (helpdesk / proxy téléphonique).
    const gate = await appointmentRouteGate(req, id, "VIEWER", "accept-alternative")
    if (gate.kind === "error") return setAppointmentSecurityHeaders(gate.res)

    const out = await rdvAppointmentService.acceptAlternative(
      gate.apptId, gate.user.id, ctx, gate.user.role,
    )
    return setAppointmentSecurityHeaders(NextResponse.json(out))
  } catch (e) {
    if (e instanceof AuthError) {
      return setAppointmentSecurityHeaders(
        NextResponse.json({ error: e.message }, { status: e.status }),
      )
    }
    return setAppointmentSecurityHeaders(
      mapErrorToResponse(e, "appointments/:id/accept-alternative POST", ctx.requestId),
    )
  }
}
