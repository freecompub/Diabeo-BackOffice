/** US-2503 — Doctor proposes an alternative date/hour after cancellation. */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { rdvAppointmentService } from "@/lib/services/rdv.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { mapErrorToResponse } from "@/lib/team-route-helpers"
import {
  appointmentRouteGate,
  setAppointmentSecurityHeaders,
} from "@/lib/appointments-route-helpers"

type RouteParams = { params: Promise<{ id: string }> }
const schema = z.object({ alternativeAt: z.coerce.date() })

/**
 * Fix HSA-2-2 round 2 review PR #433 — Le POST retourne `AppointmentDTO`
 * complet déchiffré + `proposedAlternativeAt` set. Headers ANSSI factorisés
 * via `setAppointmentSecurityHeaders` (helper partagé).
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const ctx = extractRequestContext(req)
  try {
    const { id } = await params
    const gate = await appointmentRouteGate(req, id, "DOCTOR", "propose-alternative")
    if (gate.kind === "error") return setAppointmentSecurityHeaders(gate.res)

    const body = await req.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return setAppointmentSecurityHeaders(
        NextResponse.json({ error: "validationFailed" }, { status: 400 }),
      )
    }
    const out = await rdvAppointmentService.proposeAlternative(
      gate.apptId, parsed.data.alternativeAt, gate.user.id, ctx,
    )
    return setAppointmentSecurityHeaders(NextResponse.json(out))
  } catch (e) {
    if (e instanceof AuthError) {
      return setAppointmentSecurityHeaders(
        NextResponse.json({ error: e.message }, { status: e.status }),
      )
    }
    return setAppointmentSecurityHeaders(
      mapErrorToResponse(e, "appointments/:id/propose-alternative POST", ctx.requestId),
    )
  }
}
