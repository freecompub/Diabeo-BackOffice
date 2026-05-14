/**
 * Groupe 9b Batch 2 — US-2408 Coordination équipe (infirmier).
 * GET — réutilise DelegationRequest comme inbox workflow nurse ↔ doctor.
 *
 * ⚠️ Libre chat équipe deferred (V2 — exige `TeamMessage` table).
 */

import { NextResponse, type NextRequest } from "next/server"
import { AuthError } from "@/lib/auth"
import { nurseTeamInboxQuery } from "@/lib/services/nurse-dashboard.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const user = await auditedRequireRole(req, "NURSE", ctx, "DELEGATION_REQUEST", "0")
    const items = await nurseTeamInboxQuery.forCaller(user.id, user.role, user.id, ctx)
    return NextResponse.json({ items })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "dashboard/infirmier/team-inbox GET", ctx.requestId)
  }
}
