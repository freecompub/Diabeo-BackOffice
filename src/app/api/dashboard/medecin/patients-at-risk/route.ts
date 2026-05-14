/**
 * Groupe 9b Batch 1 — US-2403 : patients à suivre pour le médecin.
 * GET — top 3 patients à risque (hypos 7j, silence saisie), computed
 * on-demand. DOCTOR-only (jugement clinique). Exclut les patients déjà
 * en urgence ouverte (visibles dans US-2401 card).
 */

import { NextResponse, type NextRequest } from "next/server"
import { AuthError } from "@/lib/auth"
import { patientsAtRiskQuery } from "@/lib/services/doctor-dashboard.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const user = await auditedRequireRole(req, "DOCTOR", ctx, "PATIENT", "0")
    const items = await patientsAtRiskQuery.forCaller(user.id, user.role, user.id, ctx)
    return NextResponse.json({ items })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "dashboard/medecin/patients-at-risk GET", ctx.requestId)
  }
}
