/**
 * Groupe 10 Batch E — US-2251 Suivi adhésion thérapeutique.
 * GET — score composite 0-100 (régularité 30j + bolus coverage).
 * NURSE+ avec canAccessPatient + requireGdprConsent.
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { adherenceQuery } from "@/lib/services/food-monitoring.service"
import {
  auditService, extractRequestContext,
} from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

const paramsSchema = z.object({ id: z.coerce.number().int().positive() })

type RouteCtx = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: RouteCtx) {
  const ctx = extractRequestContext(req)
  try {
    const parsed = paramsSchema.safeParse(await params)
    if (!parsed.success) {
      return NextResponse.json({ error: "invalidPatientId" }, { status: 400 })
    }
    const patientId = parsed.data.id
    const user = await auditedRequireRole(req, "NURSE", ctx, "PATIENT", String(patientId))
    const allowed = await canAccessPatient(user.id, user.role, patientId)
    if (!allowed) {
      await auditService.accessDenied({
        userId: user.id, resource: "PATIENT", resourceId: String(patientId),
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        metadata: { patientId, endpoint: "adherence" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
    }
    const item = await adherenceQuery.forPatient(patientId, user.id, ctx)
    return NextResponse.json({ item })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "patients/[id]/adherence GET", ctx.requestId)
  }
}
