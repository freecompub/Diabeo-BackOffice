/**
 * Groupe 9b Batch 3 — Compliance snapshot (HDS).
 * GET — lastBackup + audit volume + failed backups 30d. ADMIN-only.
 */

import { NextResponse, type NextRequest } from "next/server"
import { AuthError } from "@/lib/auth"
import { complianceQuery } from "@/lib/services/admin-dashboard.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const user = await auditedRequireRole(req, "ADMIN", ctx, "AUDIT_LOG", "0")
    const item = await complianceQuery.forCaller(user.id, ctx)
    return NextResponse.json({ item })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "dashboard/admin/compliance GET", ctx.requestId)
  }
}
