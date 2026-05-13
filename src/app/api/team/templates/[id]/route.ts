/** US-2078 — Suppression d'un template de message. */

import { NextResponse, type NextRequest } from "next/server"
import { requireRole } from "@/lib/auth"
import { messageTemplateService } from "@/lib/services/team-workflow.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { mapErrorToResponse } from "@/lib/team-route-helpers"

type RouteParams = { params: Promise<{ id: string }> }

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const user = requireRole(req, "DOCTOR")
    const { id } = await params
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: "invalidId" }, { status: 400 })
    const ctx = extractRequestContext(req)
    await messageTemplateService.delete(parseInt(id, 10), user.id, ctx)
    return NextResponse.json({ deleted: true })
  } catch (e) {
    return mapErrorToResponse(e, "team/templates DELETE")
  }
}
