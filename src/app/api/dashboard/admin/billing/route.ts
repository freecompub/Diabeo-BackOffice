/**
 * Groupe 9b Batch 3 — US-2412 Facturation à traiter (heuristique).
 * GET — counts + montant unbilled (TeleconsultationActe.invoicedAt IS NULL).
 * ADMIN-only.
 *
 * ⚠️ Fallback heuristique : table `Invoice` formelle pas encore créée
 * (US-2107 NOT STARTED). Migration vers Invoice model = follow-up V2.
 */

import { NextResponse, type NextRequest } from "next/server"
import { AuthError } from "@/lib/auth"
import { billingMetricsQuery } from "@/lib/services/admin-dashboard.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const user = await auditedRequireRole(req, "ADMIN", ctx, "APPOINTMENT", "0")
    const item = await billingMetricsQuery.forCaller(user.id, ctx)
    return NextResponse.json({ item })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "dashboard/admin/billing GET", ctx.requestId)
  }
}
