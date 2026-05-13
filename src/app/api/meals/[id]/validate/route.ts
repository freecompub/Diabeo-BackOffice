/** US-2053 — Marquer un DiabetesEvent comme validé par le soignant. */

import { NextResponse, type NextRequest } from "next/server"
import { AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { patientShareConsent } from "@/lib/consent"
import { mealValidationService } from "@/lib/services/insulin-meals.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

type RouteParams = { params: Promise<{ id: string }> }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: NextRequest, { params }: RouteParams) {
  const ctx = extractRequestContext(req)
  try {
    const { id } = await params
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "invalidEventId" }, { status: 400 })
    const user = await auditedRequireRole(req, "NURSE", ctx, "DIABETES_EVENT", id)

    const patientId = await mealValidationService.getEventPatientId(id)
    if (patientId === null) return NextResponse.json({ error: "eventNotFound" }, { status: 404 })

    const allowed = await canAccessPatient(user.id, user.role, patientId)
    if (!allowed) {
      await auditService.accessDenied({
        userId: user.id, resource: "DIABETES_EVENT", resourceId: id,
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        metadata: { patientId, endpoint: "validate" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    const consent = await patientShareConsent(patientId)
    if (!consent.ok) return NextResponse.json({ error: consent.error }, { status: consent.status })

    const out = await mealValidationService.validate(id, user.id, ctx)
    return NextResponse.json(out)
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "meals/:id/validate POST", ctx.requestId)
  }
}
