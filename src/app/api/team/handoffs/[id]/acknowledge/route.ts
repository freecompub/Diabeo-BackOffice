/** US-2086 — Le destinataire accuse réception d'un handoff. */

import { NextResponse, type NextRequest } from "next/server"
import { requireRole } from "@/lib/auth"
import { handoffNoteService } from "@/lib/services/team-workflow.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { mapErrorToResponse } from "@/lib/team-route-helpers"

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const user = requireRole(req, "NURSE")
    const { id } = await params
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: "invalidId" }, { status: 400 })
    const ctx = extractRequestContext(req)
    const out = await handoffNoteService.acknowledge(parseInt(id, 10), user.id, ctx)
    return NextResponse.json(out)
  } catch (e) {
    return mapErrorToResponse(e, "team/handoffs/:id/acknowledge POST")
  }
}
