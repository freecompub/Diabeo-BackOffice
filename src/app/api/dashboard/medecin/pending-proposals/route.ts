/**
 * US-2602 (Ma journée) — Propositions d'ajustement en attente (médecin).
 * GET — propositions `pending` du portefeuille du caller, scope RBAC.
 * minRole NURSE (DOCTOR/ADMIN éligibles). Déterministe (aucun calcul front).
 */

import { NextResponse, type NextRequest } from "next/server"
import { AuthError } from "@/lib/auth"
import { pendingProposalsQuery } from "@/lib/services/doctor-dashboard.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const user = await auditedRequireRole(req, "NURSE", ctx, "ADJUSTMENT_PROPOSAL", "0")
    const items = await pendingProposalsQuery.forCaller(user.id, user.role, user.id, ctx)
    // PHI (prénom patient déchiffré) — pas de cache proxy intermédiaire.
    return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store, private" } })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "dashboard/medecin/pending-proposals GET", ctx.requestId)
  }
}
