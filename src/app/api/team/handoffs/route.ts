/** US-2086 — Handoff notes (inbox du destinataire + création). */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole } from "@/lib/auth"
import { handoffNoteService } from "@/lib/services/team-workflow.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { mapErrorToResponse } from "@/lib/team-route-helpers"

const createSchema = z.object({
  patientId: z.number().int().positive(),
  toUserId: z.number().int().positive(),
  note: z.string().min(1).max(4096),
})

export async function GET(req: NextRequest) {
  try {
    const user = requireRole(req, "NURSE")
    const items = await handoffNoteService.listInbox(user.id)
    return NextResponse.json({ items })
  } catch (e) {
    return mapErrorToResponse(e, "team/handoffs GET")
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = requireRole(req, "NURSE")
    const ctx = extractRequestContext(req)
    const body = await req.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const out = await handoffNoteService.create(
      { ...parsed.data, fromUserId: user.id }, ctx,
    )
    return NextResponse.json(out, { status: 201 })
  } catch (e) {
    return mapErrorToResponse(e, "team/handoffs POST")
  }
}
