/** US-2501 — Appointment detail + update. */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AppointmentLocation } from "@prisma/client"
import { AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { patientShareConsent } from "@/lib/consent"
import { rdvAppointmentService } from "@/lib/services/rdv.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

type RouteParams = { params: Promise<{ id: string }> }

const HOUR_RE = /^([01]\d|2[0-3]):[0-5]\d$/

const updateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  hour: z.string().regex(HOUR_RE).optional(),
  durationMinutes: z.number().int().min(15).max(240).optional(),
  location: z.enum(AppointmentLocation).optional(),
  type: z.string().trim().max(50).optional(),
  motif: z.string().trim().max(200).optional(),
  note: z.string().max(4096).nullable().optional(),
})

async function gateById(req: NextRequest, ctx: ReturnType<typeof extractRequestContext>, id: string) {
  if (!/^\d+$/.test(id)) {
    return { kind: "error" as const, res: NextResponse.json({ error: "invalidId" }, { status: 400 }) }
  }
  const apptId = parseInt(id, 10)
  const user = await auditedRequireRole(req, "NURSE", ctx, "APPOINTMENT", id)
  const patientId = await rdvAppointmentService.getPatientIdFor(apptId)
  if (patientId === null) {
    return { kind: "error" as const, res: NextResponse.json({ error: "notFound" }, { status: 404 }) }
  }
  const allowed = await canAccessPatient(user.id, user.role, patientId)
  if (!allowed) {
    await auditService.accessDenied({
      userId: user.id, resource: "APPOINTMENT", resourceId: id,
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
      metadata: { patientId, appointmentId: apptId },
    })
    return { kind: "error" as const, res: NextResponse.json({ error: "forbidden" }, { status: 403 }) }
  }
  const consent = await patientShareConsent(patientId)
  if (!consent.ok) {
    return { kind: "error" as const, res: NextResponse.json({ error: consent.error }, { status: consent.status }) }
  }
  return { kind: "ok" as const, user, apptId, patientId }
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  const ctx = extractRequestContext(req)
  try {
    const { id } = await params
    const gate = await gateById(req, ctx, id)
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
    const gate = await gateById(req, ctx, id)
    if (gate.kind === "error") return gate.res

    const body = await req.json()
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const patch = {
      ...(parsed.data.date && { date: new Date(parsed.data.date) }),
      ...(parsed.data.hour && { hour: new Date(`1970-01-01T${parsed.data.hour}:00Z`) }),
      ...(parsed.data.durationMinutes !== undefined && { durationMinutes: parsed.data.durationMinutes }),
      ...(parsed.data.location !== undefined && { location: parsed.data.location }),
      ...(parsed.data.type !== undefined && { type: parsed.data.type }),
      ...(parsed.data.motif !== undefined && { motif: parsed.data.motif }),
      ...(parsed.data.note !== undefined && { note: parsed.data.note }),
    }
    const out = await rdvAppointmentService.update(gate.apptId, patch, gate.user.id, ctx)
    return NextResponse.json(out)
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "appointments/:id PUT", ctx.requestId)
  }
}
