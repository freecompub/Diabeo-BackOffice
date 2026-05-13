/**
 * US-2072 — Acte téléconsult (review PR #390 C3 + H1).
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { teleconsultActeService } from "@/lib/services/team-workflow.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

const schema = z.object({
  appointmentId: z.number().int().positive(),
  billingCode: z.string().regex(/^[A-Z0-9]{2,20}$/),
  amountCents: z.number().int().min(0).max(1_000_000).optional(),
})

export async function POST(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const user = await auditedRequireRole(req, "DOCTOR", ctx, "TELECONSULT_ACTE", "create")
    const body = await req.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    // C3 — verify caller has access to the patient owning the appointment
    // BEFORE the service writes the billable acte (CCAM fraud guard).
    const patientId = await teleconsultActeService.getAppointmentPatientId(parsed.data.appointmentId)
    if (patientId === null) {
      return NextResponse.json({ error: "appointmentNotFound" }, { status: 404 })
    }
    const allowed = await canAccessPatient(user.id, user.role, patientId)
    if (!allowed) {
      await auditService.accessDenied({
        userId: user.id, resource: "TELECONSULT_ACTE", resourceId: String(parsed.data.appointmentId),
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        metadata: { patientId, appointmentId: parsed.data.appointmentId, endpoint: "create" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    const row = await teleconsultActeService.create(parsed.data, user.id, ctx)
    return NextResponse.json(row, { status: 201 })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "team/teleconsult-actes POST", ctx.requestId)
  }
}
