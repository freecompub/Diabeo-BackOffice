/**
 * US-2022 — Tags affectés à un patient.
 *
 * - `GET /api/patients/:id/tags` — liste les tags posés (NURSE+ avec accès).
 * - `PUT /api/patients/:id/tags` — remplace l'ensemble par `{ tagIds: [..] }`
 *   (NURSE+). Tous les tags doivent appartenir à un cabinet dont le caller
 *   est membre (vérifié au service layer).
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole, AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { patientTagService } from "@/lib/services/patient-tag.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"

type RouteParams = { params: Promise<{ id: string }> }

const setSchema = z.object({
  tagIds: z.array(z.number().int().positive()).max(20),
})

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const user = requireRole(req, "NURSE")
    const { id } = await params
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: "invalidPatientId" }, { status: 400 })
    const patientId = parseInt(id, 10)
    const ctx = extractRequestContext(req)

    const allowed = await canAccessPatient(user.id, user.role, patientId)
    if (!allowed) {
      await auditService.accessDenied({
        userId: user.id, resource: "PATIENT_TAG_ASSIGNMENT", resourceId: String(patientId),
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        metadata: { patientId, endpoint: "list" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    const tags = await patientTagService.listForPatient(patientId)
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

    const allowed = await canAccessPatient(user.id, user.role, patientId)
    if (!allowed) {
      await auditService.accessDenied({
        userId: user.id, resource: "PATIENT_TAG_ASSIGNMENT", resourceId: String(patientId),
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        metadata: { patientId, endpoint: "set" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
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
    const msg = error instanceof Error ? error.message : "Unknown error"
    if (msg === "tagNotFound" || msg === "forbidden") {
      return NextResponse.json({ error: msg }, { status: msg === "forbidden" ? 403 : 404 })
    }
    console.error("[patients/:id/tags PUT]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
