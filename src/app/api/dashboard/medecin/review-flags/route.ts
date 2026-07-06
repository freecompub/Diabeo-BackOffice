/**
 * US-2651 (mode c) — Flags d'orientation clinique OUVERTS (médecin).
 * GET — `ClinicalReviewFlag` `open` du portefeuille du caller, scope RBAC.
 * minRole NURSE (DOCTOR/ADMIN éligibles). Objet d'orientation : JAMAIS de posologie.
 * Déterministe (aucun calcul front). PHI (prénom déchiffré) → pas de cache proxy.
 */

import { NextResponse, type NextRequest } from "next/server"
import { AuthError } from "@/lib/auth"
import { reviewFlagsQuery } from "@/lib/services/doctor-dashboard.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const user = await auditedRequireRole(req, "NURSE", ctx, "CLINICAL_REVIEW_FLAG", "0")
    const items = await reviewFlagsQuery.forCaller(user.id, user.role, user.id, ctx)
    return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store, private" } })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "dashboard/medecin/review-flags GET", ctx.requestId)
  }
}
