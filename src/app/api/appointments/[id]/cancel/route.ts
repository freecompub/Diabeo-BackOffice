/** US-2503 — Cancel an appointment (staff route).
 *
 * The route is staff-only (gate enforces NURSE+). Staff may cancel either
 * on the doctor's initiative (`actor: "doctor"`) or as a reception desk
 * recording a patient-initiated cancel (`actor: "patient"`). The immutable
 * audit log records BOTH the declared `actor` (intent) and the caller's
 * `callerRole` (forensics), so a misattribution can never silently corrupt
 * the cancel-by-doctor branch downstream (propose-alternative gate).
 *
 * Patient self-cancel (via mobile app) will use a separate `/api/patient`
 * route in a future story — out of scope here.
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { rdvAppointmentService } from "@/lib/services/rdv.service"
import {
  auditService,
  extractRequestContext,
} from "@/lib/services/audit.service"
import { mapErrorToResponse } from "@/lib/team-route-helpers"
import {
  appointmentRouteGate,
  setAppointmentSecurityHeaders,
} from "@/lib/appointments-route-helpers"

type RouteParams = { params: Promise<{ id: string }> }

const schema = z.object({
  actor: z.enum(["patient", "doctor"]),
  reason: z.string().max(500).optional(),
})

/**
 * Fix HSA-2-2 round 2 review PR #433 — Le POST retourne `AppointmentDTO`
 * complet (motif/note/cancelReason déchiffrés) via `cancel()`. Headers ANSSI
 * factorisés via `setAppointmentSecurityHeaders` (helper partagé).
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const ctx = extractRequestContext(req)
  try {
    const { id } = await params
    const gate = await appointmentRouteGate(req, id, "NURSE", "cancel")
    if (gate.kind === "error") return setAppointmentSecurityHeaders(gate.res)

    const body = await req.json().catch(() => ({}))
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return setAppointmentSecurityHeaders(
        NextResponse.json({ error: "validationFailed" }, { status: 400 }),
      )
    }

    const out = await rdvAppointmentService.cancel(
      gate.apptId,
      {
        actor: parsed.data.actor,
        reason: parsed.data.reason,
        callerRole: gate.user.role,
      },
      gate.user.id, ctx,
    )

    // H5/H8 — record the caller's role distinct from the declared actor so
    //         forensics can detect impersonation patterns (e.g. NURSE always
    //         declaring `doctor`).
    await auditService.log({
      userId: gate.user.id,
      action: "UPDATE", resource: "APPOINTMENT", resourceId: String(gate.apptId),
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
      metadata: {
        patientId: gate.patientId,
        kind: "cancel-actor-claim",
        declaredActor: parsed.data.actor,
        callerRole: gate.user.role,
      },
    })

    return setAppointmentSecurityHeaders(NextResponse.json(out))
  } catch (e) {
    if (e instanceof AuthError) {
      return setAppointmentSecurityHeaders(
        NextResponse.json({ error: e.message }, { status: e.status }),
      )
    }
    return setAppointmentSecurityHeaders(
      mapErrorToResponse(e, "appointments/:id/cancel POST", ctx.requestId),
    )
  }
}
