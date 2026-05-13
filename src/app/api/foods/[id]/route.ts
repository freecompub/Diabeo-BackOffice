/** US-2054 — Get a single CIQUAL food item. */

import { NextResponse, type NextRequest } from "next/server"
import { AuthError } from "@/lib/auth"
import { foodItemService } from "@/lib/services/insulin-meals.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: RouteParams) {
  const ctx = extractRequestContext(req)
  try {
    const { id } = await params
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: "invalidId" }, { status: 400 })
    const user = await auditedRequireRole(req, "NURSE", ctx, "FOOD_ITEM", id)
    const item = await foodItemService.getById(parseInt(id, 10), user.id, ctx)
    if (!item) return NextResponse.json({ error: "notFound" }, { status: 404 })
    return NextResponse.json(item)
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "foods/:id GET", ctx.requestId)
  }
}
