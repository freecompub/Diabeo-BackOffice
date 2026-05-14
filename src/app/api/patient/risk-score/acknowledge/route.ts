/** US-2229 — DOCTOR acknowledges a flagged risk score. */

import { NextResponse, type NextRequest } from "next/server"
import { AuthError } from "@/lib/auth"
import { resolvePatientIdFromQuery } from "@/lib/auth/query-helpers"
import { riskScoreService } from "@/lib/services/mirror-v1-analytics.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

export async function POST(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const user = await auditedRequireRole(req, "DOCTOR", ctx, "PATIENT_RISK_SCORE", "acknowledge")
    const res = await resolvePatientIdFromQuery(req, user.id, user.role)
    if (res.error) return NextResponse.json({ error: res.error }, { status: res.error === "invalidPatientId" ? 400 : 404 })
    const out = await riskScoreService.acknowledge(res.patientId, user.id, ctx)
    return NextResponse.json(out)
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "patient/risk-score/acknowledge POST", ctx.requestId)
  }
}
