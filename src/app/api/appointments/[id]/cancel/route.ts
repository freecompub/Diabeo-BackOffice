/** US-2503 — Cancel an appointment (patient or doctor). */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { rdvAppointmentService } from "@/lib/services/rdv.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { mapErrorToResponse } from "@/lib/team-route-helpers"
import { appointmentRouteGate } from "@/lib/appointments-route-helpers"

type RouteParams = { params: Promise<{ id: string }> }

const schema = z.object({
  reason: z.string().max(500).optional(),
})

export async function POST(req: NextRequest, { params }: RouteParams) {
  const ctx = extractRequestContext(req)
  try {
    const { id } = await params
    const gate = await appointmentRouteGate(req, id, "NURSE", "cancel")
    if (gate.kind === "error") return gate.res

    const body = await req.json().catch(() => ({}))
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }
    // H4 — actor is derived from the caller's role (never from request body).
    // VIEWER falls into the patient branch (read-side; cancels via patient flow);
    // NURSE/DOCTOR/ADMIN cancel on behalf of the doctor.
    const actor = gate.user.role === "VIEWER" ? "patient" : "doctor"

    const out = await rdvAppointmentService.cancel(
      gate.apptId, { actor, reason: parsed.data.reason }, gate.user.id, ctx,
    )
    return NextResponse.json(out)
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "appointments/:id/cancel POST", ctx.requestId)
  }
}
