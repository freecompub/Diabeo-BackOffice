/** US-2500/2501 — Appointments list (calendar) + create. */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AppointmentLocation, AppointmentStatus } from "@prisma/client"
import { AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { patientShareConsent } from "@/lib/consent"
import {
  rdvAppointmentService,
  assertMemberServiceAccess,
} from "@/lib/services/rdv.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"
import { HOUR_RE } from "@/lib/appointments-route-helpers"

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

    // C1 — refuse unscoped listings (cross-tenant PHI leak otherwise).
    if (parsed.data.memberId === undefined && parsed.data.patientId === undefined) {
      return NextResponse.json({ error: "scopeRequired" }, { status: 400 })
    }

    const user = await auditedRequireRole(req, "NURSE", ctx, "APPOINTMENT", "list")

    // C1 — when scoped by patient, enforce per-patient access control.
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
    // C1/L1 — when scoped by member (with or without patient), enforce
    //         same-service membership. Defense-in-depth: even when patientId
    //         is also provided (and authorised), a cross-tenant memberId must
    //         not leak via empty results.
    if (parsed.data.memberId !== undefined) {
      try {
        await assertMemberServiceAccess(user.id, parsed.data.memberId)
      } catch (err) {
        return mapErrorToResponse(err, "appointments GET", ctx.requestId, {
          user, ctx, resource: "APPOINTMENT",
          resourceId: `member:${parsed.data.memberId}`,
          metadata: { memberId: parsed.data.memberId, endpoint: "list" },
        })
      }
    }

    const out = await rdvAppointmentService.listInRange(parsed.data, user.id, ctx)
    const res = NextResponse.json(out)
    // Fix H-2 round 2 review PR #431 — Headers ANSSI RGS §4.5 + RGPD
    // Art. 32 sur la réponse list qui contient PHI déchiffrée (motif).
    // Empêche cache browser disk + CDN/proxy entreprise + back button.
    res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, private")
    res.headers.set("Pragma", "no-cache")
    res.headers.set("Referrer-Policy", "no-referrer")
    res.headers.set("X-Content-Type-Options", "nosniff")
    return res
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
