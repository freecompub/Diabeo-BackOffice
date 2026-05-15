/**
 * @route GET /api/admin/system-health
 * @description US-2150 Dashboard santé système (ADMIN-only).
 *
 * Vue enrichie : DB / Redis / CGM ingestion lag / last backup /
 * active sessions / recent errors 24h. Différent de `/api/health`
 * public qui ne renvoie que le statut composé.
 */
import { NextResponse, type NextRequest } from "next/server"
import { AuthError } from "@/lib/auth"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"
import { systemHealthService } from "@/lib/services/system-health.service"

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const user = await auditedRequireRole(req, "ADMIN", ctx, "SYSTEM_HEALTH", "snapshot")
    const snapshot = await systemHealthService.snapshot(user.id, ctx)
    return NextResponse.json(snapshot)
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "admin/system-health GET", ctx.requestId)
  }
}
