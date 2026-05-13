/** US-2068 — Consultation notes par patient (review PR #390 H1, M2). */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { patientShareConsent } from "@/lib/consent"
import { consultationNoteService } from "@/lib/services/team-workflow.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { prisma } from "@/lib/db/client"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

type RouteParams = { params: Promise<{ id: string }> }

const createSchema = z.object({
  content: z.string().min(1).max(8192),
  category: z.string().max(40).optional(),
  appointmentId: z.number().int().positive().optional(),
})

async function ensurePatientAlive(id: number): Promise<boolean> {
  const p = await prisma.patient.findFirst({
    where: { id, deletedAt: null }, select: { id: true },
  })
  return !!p
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  const ctx = extractRequestContext(req)
  try {
    const { id } = await params
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: "invalidPatientId" }, { status: 400 })
    const patientId = parseInt(id, 10)
    const user = await auditedRequireRole(req, "NURSE", ctx, "CONSULTATION_NOTE", String(patientId))

    if (!(await ensurePatientAlive(patientId))) {
      return NextResponse.json({ error: "patientNotFound" }, { status: 404 })
    }
    const allowed = await canAccessPatient(user.id, user.role, patientId)
    if (!allowed) {
      await auditService.accessDenied({
        userId: user.id, resource: "CONSULTATION_NOTE", resourceId: String(patientId),
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        metadata: { patientId, endpoint: "list" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    const consent = await patientShareConsent(patientId)
    if (!consent.ok) return NextResponse.json({ error: consent.error }, { status: consent.status })

    const items = await consultationNoteService.listForPatient(patientId, user.id, ctx)
    return NextResponse.json({ items })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "patients/:id/consultation-notes GET", ctx.requestId)
  }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const ctx = extractRequestContext(req)
  try {
    const { id } = await params
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: "invalidPatientId" }, { status: 400 })
    const patientId = parseInt(id, 10)
    const user = await auditedRequireRole(req, "DOCTOR", ctx, "CONSULTATION_NOTE", String(patientId))

    if (!(await ensurePatientAlive(patientId))) {
      return NextResponse.json({ error: "patientNotFound" }, { status: 404 })
    }
    const allowed = await canAccessPatient(user.id, user.role, patientId)
    if (!allowed) {
      await auditService.accessDenied({
        userId: user.id, resource: "CONSULTATION_NOTE", resourceId: String(patientId),
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        metadata: { patientId, endpoint: "create" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    const consent = await patientShareConsent(patientId)
    if (!consent.ok) return NextResponse.json({ error: consent.error }, { status: consent.status })

    const body = await req.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const out = await consultationNoteService.create(
      { ...parsed.data, patientId, authorId: user.id }, ctx,
    )
    return NextResponse.json(out, { status: 201 })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "patients/:id/consultation-notes POST", ctx.requestId)
  }
}
