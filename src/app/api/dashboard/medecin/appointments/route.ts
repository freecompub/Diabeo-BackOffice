/**
 * Groupe 9b Batch 1 — US-2402 : RDV du jour pour le médecin.
 * GET — max 3 RDV du jour, scope portefeuille, triés par heure.
 */

import { NextResponse, type NextRequest } from "next/server"
import { AuthError } from "@/lib/auth"
import { appointmentsQuery } from "@/lib/services/doctor-dashboard.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const user = await auditedRequireRole(req, "NURSE", ctx, "APPOINTMENT", "0")
    const items = await appointmentsQuery.forCaller(user.id, user.role, user.id, ctx)
    return NextResponse.json({ items })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "dashboard/medecin/appointments GET", ctx.requestId)
  }
}
