/**
 * US-2022 — Tags affectés à un patient.
 *
 * Sécurité (post-review PR #389):
 *  - H1 : `patientShareConsent` gate.
 *  - H6 : pré-check existence patient avant `accessDenied`.
 *  - H8 : `TagForbiddenError` typé (403 uniforme, pas d'oracle d'énumération).
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole, AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { patientShareConsent } from "@/lib/consent"
import { patientTagService } from "@/lib/services/patient-tag.service"
import {
  TagForbiddenError,
  TagNotFoundError,
} from "@/lib/services/patient-tag.errors"
import { prisma } from "@/lib/db/client"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"

type RouteParams = { params: Promise<{ id: string }> }

const setSchema = z.object({
  tagIds: z.array(z.number().int().positive()).max(20),
})

async function ensurePatientAlive(patientId: number): Promise<boolean> {
  const p = await prisma.patient.findFirst({
    where: { id: patientId, deletedAt: null }, select: { id: true },
  })
  return !!p
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const user = requireRole(req, "NURSE")
    const { id } = await params
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: "invalidPatientId" }, { status: 400 })
    const patientId = parseInt(id, 10)
    const ctx = extractRequestContext(req)

    if (!(await ensurePatientAlive(patientId))) {
      return NextResponse.json({ error: "patientNotFound" }, { status: 404 })
    }

    const allowed = await canAccessPatient(user.id, user.role, patientId)
    if (!allowed) {
      await auditService.accessDenied({
        userId: user.id, resource: "PATIENT_TAG_ASSIGNMENT", resourceId: String(patientId),
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        metadata: { patientId, endpoint: "list" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    const consent = await patientShareConsent(patientId)
    if (!consent.ok) {
      return NextResponse.json({ error: consent.error }, { status: consent.status })
    }

    const tags = await patientTagService.listForPatient(patientId, user.id, ctx)
    return NextResponse.json({ items: tags })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[patients/:id/tags GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const user = requireRole(req, "NURSE")
    const { id } = await params
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: "invalidPatientId" }, { status: 400 })
    const patientId = parseInt(id, 10)
    const ctx = extractRequestContext(req)

    if (!(await ensurePatientAlive(patientId))) {
      return NextResponse.json({ error: "patientNotFound" }, { status: 404 })
    }

    const allowed = await canAccessPatient(user.id, user.role, patientId)
    if (!allowed) {
      await auditService.accessDenied({
        userId: user.id, resource: "PATIENT_TAG_ASSIGNMENT", resourceId: String(patientId),
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        metadata: { patientId, endpoint: "set" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    const consent = await patientShareConsent(patientId)
    if (!consent.ok) {
      return NextResponse.json({ error: consent.error }, { status: consent.status })
    }

    const body = await req.json()
    const parsed = setSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const result = await patientTagService.setForPatient(
      patientId, parsed.data.tagIds, user.id, ctx,
    )
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof TagForbiddenError || error instanceof TagNotFoundError) {
      // Both fold to 403 uniformly to prevent enumeration (C2).
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[patients/:id/tags PUT]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
