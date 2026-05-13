/** US-2078 — Delete template (review PR #390 H1). */

import { NextResponse, type NextRequest } from "next/server"
import { AuthError } from "@/lib/auth"
import { messageTemplateService } from "@/lib/services/team-workflow.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

type RouteParams = { params: Promise<{ id: string }> }

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const ctx = extractRequestContext(req)
  try {
    const { id } = await params
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: "invalidId" }, { status: 400 })
    const user = await auditedRequireRole(req, "DOCTOR", ctx, "MESSAGE_TEMPLATE", id)
    await messageTemplateService.delete(parseInt(id, 10), user.id, ctx)
    return NextResponse.json({ deleted: true })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "team/templates DELETE", ctx.requestId)
  }
}
