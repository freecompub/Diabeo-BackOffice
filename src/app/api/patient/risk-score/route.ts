/** US-2229 — Per-patient risk score (GET) + manual recompute (POST). */

import { NextResponse, type NextRequest } from "next/server"
import { AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { resolvePatientIdFromQuery } from "@/lib/auth/query-helpers"
import { requireGdprConsent } from "@/lib/gdpr"
import { riskScoreService } from "@/lib/services/mirror-v1-analytics.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"
import type { Role } from "@prisma/client"

async function gate(req: NextRequest, minRole: Role) {
  const ctx = extractRequestContext(req)
  const user = await auditedRequireRole(req, minRole, ctx, "PATIENT_RISK_SCORE", "0")
  const res = await resolvePatientIdFromQuery(req, user.id, user.role)
  if (res.error) return { error: NextResponse.json({ error: res.error }, { status: res.error === "invalidPatientId" ? 400 : 404 }) }
  const allowed = await canAccessPatient(user.id, user.role, res.patientId)
  if (!allowed) {
    await auditService.accessDenied({
      userId: user.id, resource: "PATIENT_RISK_SCORE", resourceId: String(res.patientId),
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
      metadata: { patientId: res.patientId, endpoint: "risk-score" },
    })
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) }
  }
  const hasConsent = await requireGdprConsent(user.id)
  if (!hasConsent) return { error: NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 }) }
  return { user, ctx, patientId: res.patientId }
}

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const g = await gate(req, "NURSE")
    if ("error" in g) return g.error
    const out = await riskScoreService.getByPatient(g.patientId, g.user.id, g.ctx)
    if (!out) return NextResponse.json({ error: "notFound" }, { status: 404 })
    return NextResponse.json(out)
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "patient/risk-score GET", ctx.requestId)
  }
}

export async function POST(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const g = await gate(req, "DOCTOR")
    if ("error" in g) return g.error
    const out = await riskScoreService.recompute(g.patientId, g.user.id, g.ctx)
    return NextResponse.json(out)
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "patient/risk-score POST", ctx.requestId)
  }
}
