/** US-2088 — Groupes patient (review PR #390 H1 + L2). */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { patientShareConsent } from "@/lib/consent"
import { patientGroupService } from "@/lib/services/team-workflow.service"
import { prisma } from "@/lib/db/client"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

type RouteParams = { params: Promise<{ id: string }> }

const setSchema = z.object({
  groupIds: z.array(z.number().int().positive()).max(20),
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
    const user = await auditedRequireRole(req, "NURSE", ctx, "PATIENT_GROUP_ASSIGNMENT", String(patientId))

    if (!(await ensurePatientAlive(patientId))) {
      return NextResponse.json({ error: "patientNotFound" }, { status: 404 })
    }
    const allowed = await canAccessPatient(user.id, user.role, patientId)
    if (!allowed) {
      await auditService.accessDenied({
        userId: user.id, resource: "PATIENT_GROUP_ASSIGNMENT", resourceId: String(patientId),
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        metadata: { patientId, endpoint: "list" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    const consent = await patientShareConsent(patientId)
    if (!consent.ok) return NextResponse.json({ error: consent.error }, { status: consent.status })

    const items = await patientGroupService.listForPatient(patientId, user.id, ctx)
    return NextResponse.json({ items })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "patients/:id/groups GET", ctx.requestId)
  }
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  const ctx = extractRequestContext(req)
  try {
    const { id } = await params
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: "invalidPatientId" }, { status: 400 })
    const patientId = parseInt(id, 10)
    const user = await auditedRequireRole(req, "NURSE", ctx, "PATIENT_GROUP_ASSIGNMENT", String(patientId))

    if (!(await ensurePatientAlive(patientId))) {
      return NextResponse.json({ error: "patientNotFound" }, { status: 404 })
    }
    const allowed = await canAccessPatient(user.id, user.role, patientId)
    if (!allowed) {
      await auditService.accessDenied({
        userId: user.id, resource: "PATIENT_GROUP_ASSIGNMENT", resourceId: String(patientId),
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        metadata: { patientId, endpoint: "set" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    const consent = await patientShareConsent(patientId)
    if (!consent.ok) return NextResponse.json({ error: consent.error }, { status: consent.status })

    const body = await req.json()
    const parsed = setSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const out = await patientGroupService.setForPatient(
      patientId, parsed.data.groupIds, user.id, ctx,
    )
    return NextResponse.json(out)
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "patients/:id/groups PUT", ctx.requestId)
  }
}
