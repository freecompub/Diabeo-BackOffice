/**
 * Groupe 9b Batch 2 — US-2409 Relances en attente (infirmier).
 * GET — heuristique fallback : Patient sans CGM >7j OU Appointment
 * pending_validation >3j. NURSE+ + portfolio scope.
 *
 * ⚠️ Twilio SMS server-side + `PatientRecallLog` deferred ; UI utilise
 * `tel:` + `sms:` URI natif (V2 follow-up).
 */

import { NextResponse, type NextRequest } from "next/server"
import { AuthError } from "@/lib/auth"
import { nurseRecallQuery } from "@/lib/services/nurse-dashboard.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const user = await auditedRequireRole(req, "NURSE", ctx, "PATIENT", "0")
    const items = await nurseRecallQuery.forCaller(user.id, user.role, user.id, ctx)
    return NextResponse.json({ items })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "dashboard/infirmier/recall-list GET", ctx.requestId)
  }
}
