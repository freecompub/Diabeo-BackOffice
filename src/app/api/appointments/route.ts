/** US-2500/2501 — Appointments list (calendar) + create. */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AppointmentLocation, AppointmentStatus } from "@prisma/client"
import { AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { patientShareConsent } from "@/lib/consent"
import { rdvAppointmentService } from "@/lib/services/rdv.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

const HOUR_RE = /^([01]\d|2[0-3]):[0-5]\d$/

const listSchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  memberId: z.coerce.number().int().positive().optional(),
  patientId: z.coerce.number().int().positive().optional(),
  status: z.enum(AppointmentStatus).optional(),
})

const createSchema = z.object({
  patientId: z.number().int().positive(),
  memberId: z.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hour: z.string().regex(HOUR_RE),
  durationMinutes: z.number().int().min(15).max(240).optional(),
  location: z.enum(AppointmentLocation).optional(),
  type: z.string().trim().max(50).optional(),
  motif: z.string().trim().max(200).optional(),
  note: z.string().max(4096).optional(),
})

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const parsed = listSchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams.entries()),
    )
    if (!parsed.success) return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    const user = await auditedRequireRole(req, "NURSE", ctx, "APPOINTMENT", "list")

    if (parsed.data.patientId !== undefined) {
      const allowed = await canAccessPatient(user.id, user.role, parsed.data.patientId)
      if (!allowed) {
        await auditService.accessDenied({
          userId: user.id, resource: "APPOINTMENT", resourceId: String(parsed.data.patientId),
          ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
          metadata: { patientId: parsed.data.patientId, endpoint: "list" },
        })
        return NextResponse.json({ error: "forbidden" }, { status: 403 })
      }
    }

    const items = await rdvAppointmentService.listInRange(parsed.data, user.id, ctx)
    return NextResponse.json({ items })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "appointments GET", ctx.requestId)
  }
}

export async function POST(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const body = await req.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const user = await auditedRequireRole(req, "NURSE", ctx, "APPOINTMENT", "create")

    const allowed = await canAccessPatient(user.id, user.role, parsed.data.patientId)
    if (!allowed) {
      await auditService.accessDenied({
        userId: user.id, resource: "APPOINTMENT", resourceId: String(parsed.data.patientId),
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        metadata: { patientId: parsed.data.patientId, endpoint: "create" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    const consent = await patientShareConsent(parsed.data.patientId)
    if (!consent.ok) return NextResponse.json({ error: consent.error }, { status: consent.status })

    const out = await rdvAppointmentService.create(
      {
        patientId: parsed.data.patientId,
        memberId: parsed.data.memberId,
        date: new Date(parsed.data.date),
        hour: new Date(`1970-01-01T${parsed.data.hour}:00Z`),
        durationMinutes: parsed.data.durationMinutes,
        location: parsed.data.location,
        type: parsed.data.type,
        motif: parsed.data.motif,
        note: parsed.data.note,
      },
      user.id, ctx,
    )
    return NextResponse.json(out, { status: 201 })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "appointments POST", ctx.requestId)
  }
}
