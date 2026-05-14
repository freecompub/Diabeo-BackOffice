/** US-2229 — Per-patient risk score (GET) + manual recompute (POST). */

import { NextResponse, type NextRequest } from "next/server"
import { AuthError } from "@/lib/auth"
import { resolvePatientIdFromQuery } from "@/lib/auth/query-helpers"
import { riskScoreService } from "@/lib/services/mirror-v1-analytics.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const user = await auditedRequireRole(req, "NURSE", ctx, "PATIENT_RISK_SCORE", "read")
    const res = await resolvePatientIdFromQuery(req, user.id, user.role)
    if (res.error) return NextResponse.json({ error: res.error }, { status: res.error === "invalidPatientId" ? 400 : 404 })
    const out = await riskScoreService.getByPatient(res.patientId, user.id, ctx)
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
    const user = await auditedRequireRole(req, "DOCTOR", ctx, "PATIENT_RISK_SCORE", "recompute")
    const res = await resolvePatientIdFromQuery(req, user.id, user.role)
    if (res.error) return NextResponse.json({ error: res.error }, { status: res.error === "invalidPatientId" ? 400 : 404 })
    const out = await riskScoreService.recompute(res.patientId, user.id, ctx)
    return NextResponse.json(out)
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "patient/risk-score POST", ctx.requestId)
  }
}
