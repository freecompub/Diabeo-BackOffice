/** US-2221 — DOCTOR signs off on a NURSE-created config version. */

import { NextResponse, type NextRequest } from "next/server"
import { AuthError } from "@/lib/auth"
import { configVersionHistoryService } from "@/lib/services/mirror-v1-config.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: RouteParams) {
  const ctx = extractRequestContext(req)
  try {
    const { id } = await params
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: "invalidId" }, { status: 400 })
    const user = await auditedRequireRole(req, "DOCTOR", ctx, "CONFIG_VERSION", id)
    const out = await configVersionHistoryService.validate(parseInt(id, 10), user.id, ctx)
    return NextResponse.json(out)
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "admin/config-history/:id/validate POST", ctx.requestId)
  }
}
