/**
 * Groupe 9b Batch 1 — US-2404 : KPI cabinet 14j pour le médecin.
 * GET — 4 KPI cards : patients actifs, TIR moyen, urgences sem, propositions
 * en attente. Trend vs 14j précédents quand calculable.
 */

import { NextResponse, type NextRequest } from "next/server"
import { AuthError } from "@/lib/auth"
import { kpisQuery } from "@/lib/services/doctor-dashboard.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const user = await auditedRequireRole(req, "DOCTOR", ctx, "PATIENT", "0")
    const items = await kpisQuery.forCaller(user.id, user.role, user.id, ctx)
    return NextResponse.json({ items })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "dashboard/medecin/kpi GET", ctx.requestId)
  }
}
