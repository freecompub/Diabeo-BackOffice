/**
 * Groupe 10 Batch C — Deactivate active mode (US-2233/2234/2235).
 * POST — archive the active mode for a patient. Idempotent (200 with
 * `{ archived: false }` if no active mode). DOCTOR+ only.
 */

import { NextResponse, type NextRequest } from "next/server"
import { AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { resolvePatientIdFromQuery } from "@/lib/auth/query-helpers"
import { requireGdprConsent } from "@/lib/gdpr"
import {
  MODE_TYPES, type ModeTypeParam, resolveConfigType,
} from "@/lib/patient-modes-shared"
import { patientModeWorkflow } from "@/lib/services/patient-modes.service"
import {
  auditService, extractRequestContext,
} from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

type RouteCtx = { params: Promise<{ type: string }> }

export async function POST(req: NextRequest, { params }: RouteCtx) {
  const { type } = await params
  const ctx = extractRequestContext(req)
  try {
    if (!MODE_TYPES.includes(type as ModeTypeParam)) {
      return NextResponse.json({ error: "unsupportedModeType" }, { status: 400 })
    }
    const configType = resolveConfigType(type)!
    const user = await auditedRequireRole(req, "DOCTOR", ctx, "CONFIG_VERSION", "deactivate")
    const res = await resolvePatientIdFromQuery(req, user.id, user.role)
    if (res.error) {
      return NextResponse.json({ error: res.error }, {
        status: res.error === "invalidPatientId" ? 400 : 404,
      })
    }
    const allowed = await canAccessPatient(user.id, user.role, res.patientId)
    if (!allowed) {
      await auditService.accessDenied({
        userId: user.id, resource: "CONFIG_VERSION", resourceId: String(res.patientId),
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        metadata: { patientId: res.patientId, mode: type, endpoint: "deactivate" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
    }
    const out = await patientModeWorkflow.deactivate(
      res.patientId, configType, user.id, ctx,
    )
    return NextResponse.json(out)
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, `patient/modes/${type}/deactivate POST`, ctx.requestId)
  }
}
