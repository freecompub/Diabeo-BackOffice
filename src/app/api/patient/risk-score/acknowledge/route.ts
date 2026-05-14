/** US-2229 — DOCTOR acknowledges a flagged risk score. */

import { NextResponse, type NextRequest } from "next/server"
import { AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { resolvePatientIdFromQuery } from "@/lib/auth/query-helpers"
import { requireGdprConsent } from "@/lib/gdpr"
import { riskScoreService } from "@/lib/services/mirror-v1-analytics.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

export async function POST(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const user = await auditedRequireRole(req, "DOCTOR", ctx, "PATIENT_RISK_SCORE", "0")
    const res = await resolvePatientIdFromQuery(req, user.id, user.role)
    if (res.error) return NextResponse.json({ error: res.error }, { status: res.error === "invalidPatientId" ? 400 : 404 })
    const allowed = await canAccessPatient(user.id, user.role, res.patientId)
    if (!allowed) {
      await auditService.accessDenied({
        userId: user.id, resource: "PATIENT_RISK_SCORE", resourceId: String(res.patientId),
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        metadata: { patientId: res.patientId, endpoint: "acknowledge" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    // C1-NEW — GDPR consent required (risk score = clinical judgment data).
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
    }
    const out = await riskScoreService.acknowledge(res.patientId, user.id, ctx)
    return NextResponse.json(out)
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "patient/risk-score/acknowledge POST", ctx.requestId)
  }
}
