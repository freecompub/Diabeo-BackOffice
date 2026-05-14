/**
 * Groupe 9b Batch 3 — US-2410 Admin KPI overview.
 * GET — 4 metrics : cabinets, staff, patients actifs 14j, audit 7d.
 * ADMIN-only.
 */

import { NextResponse, type NextRequest } from "next/server"
import { AuthError } from "@/lib/auth"
import { adminKpiQuery } from "@/lib/services/admin-dashboard.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const user = await auditedRequireRole(req, "ADMIN", ctx, "PATIENT", "0")
    const items = await adminKpiQuery.forCaller(user.id, ctx)
    return NextResponse.json({ items })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "dashboard/admin/kpi GET", ctx.requestId)
  }
}
