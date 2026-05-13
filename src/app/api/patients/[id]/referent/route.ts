/**
 * US-2021 — Transfert du médecin référent d'un patient.
 * US-2028 — Vue multi-praticiens (membres des services rattachés).
 *
 * - `GET  /api/patients/:id/referent` — vue d'équipe (référent principal +
 *   tous les membres des services rattachés). Lecture NURSE+ avec accès.
 * - `PUT  /api/patients/:id/referent` — bascule du référent principal vers
 *   un autre `HealthcareMember`. DOCTOR+ uniquement. Le nouveau référent
 *   doit être membre d'un des services du patient.
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth, requireRole, AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { patientReferentService } from "@/lib/services/patient-referent.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"

type RouteParams = { params: Promise<{ id: string }> }

const transferSchema = z.object({
  newProMemberId: z.number().int().positive(),
})

async function readPatientId(params: RouteParams["params"]) {
  const { id } = await params
  if (!/^\d+$/.test(id)) return null
  return parseInt(id, 10)
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const user = requireAuth(req)
    const patientId = await readPatientId(params)
    if (patientId === null) return NextResponse.json({ error: "invalidPatientId" }, { status: 400 })

    const ctx = extractRequestContext(req)
    const allowed = await canAccessPatient(user.id, user.role, patientId)
    if (!allowed) {
      await auditService.accessDenied({
        userId: user.id, resource: "REFERENT", resourceId: String(patientId),
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        metadata: { patientId, endpoint: "list" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    const entries = await patientReferentService.getReferentsView(patientId, user.id, ctx)
    return NextResponse.json({ items: entries })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[patients/:id/referent GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const user = requireRole(req, "DOCTOR")
    const patientId = await readPatientId(params)
    if (patientId === null) return NextResponse.json({ error: "invalidPatientId" }, { status: 400 })

    const ctx = extractRequestContext(req)
    const allowed = await canAccessPatient(user.id, user.role, patientId)
    if (!allowed) {
      await auditService.accessDenied({
        userId: user.id, resource: "REFERENT", resourceId: String(patientId),
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        metadata: { patientId, endpoint: "transfer" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    const body = await req.json()
    const parsed = transferSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const result = await patientReferentService.transferReferent(
      patientId, parsed.data.newProMemberId, user.id, ctx,
    )
    return NextResponse.json({ id: result.id, proId: result.proId, serviceId: result.serviceId })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    if (msg === "memberNotEligible") {
      return NextResponse.json({ error: "memberNotEligible" }, { status: 422 })
    }
    console.error("[patients/:id/referent PUT]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
