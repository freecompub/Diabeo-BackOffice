/**
 * Groupe 9b Batch 1 — US-2401 : urgences en cours pour le médecin.
 * GET — max 5 alerts triées par criticité, scope portefeuille.
 *
 * Polling client : 30s (ADR session Samir 2026-05-13 — WS reporté V2/V3).
 */

import { NextResponse, type NextRequest } from "next/server"
import { AuthError } from "@/lib/auth"
import { urgenciesQuery } from "@/lib/services/doctor-dashboard.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const user = await auditedRequireRole(req, "NURSE", ctx, "EMERGENCY_ALERT", "0")
    const items = await urgenciesQuery.forCaller(user.id, user.role, user.id, ctx)
    return NextResponse.json({ items })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "dashboard/medecin/urgencies GET", ctx.requestId)
  }
}
