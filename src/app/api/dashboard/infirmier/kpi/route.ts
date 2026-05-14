/**
 * Groupe 9b Batch 2 — US-2406 KPI ma journée (infirmier).
 * GET — 4 metrics : RDV à préparer, événements à valider, urgences
 * observées, propositions à connaître. NURSE+ + portfolio scope.
 */

import { NextResponse, type NextRequest } from "next/server"
import { AuthError } from "@/lib/auth"
import { nurseKpiQuery } from "@/lib/services/nurse-dashboard.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const user = await auditedRequireRole(req, "NURSE", ctx, "PATIENT", "0")
    const items = await nurseKpiQuery.forCaller(user.id, user.role, user.id, ctx)
    return NextResponse.json({ items })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "dashboard/infirmier/kpi GET", ctx.requestId)
  }
}

// code-review M5 (re-review) — `mapErrorToResponse` is called WITHOUT an
//   `auditTarget` because the service has no `ForbiddenError` throw paths
//   today ; `auditedRequireRole` already covers 403-on-role. Future defensive
//   hardening : pass `auditTarget: { user, ctx, resource:"PATIENT", resourceId:"0" }`
//   if downstream services start throwing ForbiddenError (US-2265 parity).
