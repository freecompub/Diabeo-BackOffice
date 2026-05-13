/** US-2072 — Marquer un acte téléconsult comme facturé. */

import { NextResponse, type NextRequest } from "next/server"
import { requireRole } from "@/lib/auth"
import { teleconsultActeService } from "@/lib/services/team-workflow.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { mapErrorToResponse } from "@/lib/team-route-helpers"

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const user = requireRole(req, "ADMIN")
    const { id } = await params
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: "invalidId" }, { status: 400 })
    const ctx = extractRequestContext(req)
    const updated = await teleconsultActeService.markInvoiced(parseInt(id, 10), user.id, ctx)
    return NextResponse.json(updated)
  } catch (e) {
    return mapErrorToResponse(e, "team/teleconsult-actes/:id/invoice POST")
  }
}
