/**
 * Groupe 9b Batch 2 — US-2407 To-do du jour (infirmier, READ-ONLY).
 * GET — compute on-demand depuis Appointment + DiabetesEvent +
 * AdjustmentProposal. NURSE+ + portfolio scope.
 *
 * ⚠️ Checkbox completion + 30s undo + notification doctor deferred ;
 * exige `NurseTaskItem` table (V2 follow-up).
 */

import { NextResponse, type NextRequest } from "next/server"
import { AuthError } from "@/lib/auth"
import { nurseTodoQuery } from "@/lib/services/nurse-dashboard.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const user = await auditedRequireRole(req, "NURSE", ctx, "PATIENT", "0")
    const items = await nurseTodoQuery.forCaller(user.id, user.role, user.id, ctx)
    return NextResponse.json({ items })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "dashboard/infirmier/todo GET", ctx.requestId)
  }
}
