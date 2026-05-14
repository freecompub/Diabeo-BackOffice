/** US-2501 — Appointment detail + update. */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AppointmentLocation } from "@prisma/client"
import { AuthError } from "@/lib/auth"
import { rdvAppointmentService } from "@/lib/services/rdv.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { mapErrorToResponse } from "@/lib/team-route-helpers"
import { appointmentRouteGate, HOUR_RE } from "@/lib/appointments-route-helpers"

type RouteParams = { params: Promise<{ id: string }> }

const updateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  hour: z.string().regex(HOUR_RE).optional(),
  durationMinutes: z.number().int().min(15).max(240).optional(),
  location: z.enum(AppointmentLocation).optional(),
  type: z.string().trim().max(50).optional(),
  motif: z.string().trim().max(200).nullable().optional(),
  note: z.string().max(4096).nullable().optional(),
})

export async function GET(req: NextRequest, { params }: RouteParams) {
  const ctx = extractRequestContext(req)
  try {
    const { id } = await params
    const gate = await appointmentRouteGate(req, id, "NURSE", "detail")
    if (gate.kind === "error") return gate.res
    const item = await rdvAppointmentService.getById(gate.apptId, gate.user.id, ctx)
    if (!item) return NextResponse.json({ error: "notFound" }, { status: 404 })
    return NextResponse.json(item)
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "appointments/:id GET", ctx.requestId)
  }
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  const ctx = extractRequestContext(req)
  try {
    const { id } = await params
    const gate = await appointmentRouteGate(req, id, "NURSE", "update")
    if (gate.kind === "error") return gate.res

    const body = await req.json()
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    // H6 — preserve `null` as explicit clear (don't drop it via && short-circuit).
    const patch: Parameters<typeof rdvAppointmentService.update>[1] = {}
    if (parsed.data.date) patch.date = new Date(parsed.data.date)
    if (parsed.data.hour) patch.hour = new Date(`1970-01-01T${parsed.data.hour}:00Z`)
    if (parsed.data.durationMinutes !== undefined) patch.durationMinutes = parsed.data.durationMinutes
    if (parsed.data.location !== undefined) patch.location = parsed.data.location
    if (parsed.data.type !== undefined) patch.type = parsed.data.type
    if (parsed.data.motif !== undefined) patch.motif = parsed.data.motif
    if (parsed.data.note !== undefined) patch.note = parsed.data.note

    const out = await rdvAppointmentService.update(gate.apptId, patch, gate.user.id, ctx)
    return NextResponse.json(out)
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "appointments/:id PUT", ctx.requestId)
  }
}
