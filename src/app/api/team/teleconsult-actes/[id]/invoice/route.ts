/** US-2072 — Marquer un acte téléconsult comme facturé (review PR #390 H1 + L11). */

import { NextResponse, type NextRequest } from "next/server"
import { AuthError } from "@/lib/auth"
import { teleconsultActeService } from "@/lib/services/team-workflow.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: RouteParams) {
  const ctx = extractRequestContext(req)
  try {
    const { id } = await params
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: "invalidId" }, { status: 400 })
    const user = await auditedRequireRole(req, "ADMIN", ctx, "TELECONSULT_ACTE", id)
    const updated = await teleconsultActeService.markInvoiced(parseInt(id, 10), user.id, ctx)
    return NextResponse.json(updated)
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "team/teleconsult-actes/:id/invoice POST", ctx.requestId)
  }
}
