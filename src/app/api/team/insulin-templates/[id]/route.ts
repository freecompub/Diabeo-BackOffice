/** US-2050 — Delete insulin adjustment template. */

import { NextResponse, type NextRequest } from "next/server"
import { AuthError } from "@/lib/auth"
import { insulinAdjustmentTemplateService } from "@/lib/services/insulin-meals.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

type RouteParams = { params: Promise<{ id: string }> }

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const ctx = extractRequestContext(req)
  try {
    const { id } = await params
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: "invalidId" }, { status: 400 })
    const user = await auditedRequireRole(req, "DOCTOR", ctx, "INSULIN_ADJUSTMENT_TEMPLATE", id)
    await insulinAdjustmentTemplateService.delete(parseInt(id, 10), user.id, ctx)
    return NextResponse.json({ deleted: true })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "team/insulin-templates DELETE", ctx.requestId)
  }
}
