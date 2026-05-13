/** US-2083 — Délégation IDE → DOCTOR (création + inbox du reviewer). */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole } from "@/lib/auth"
import { delegationRequestService } from "@/lib/services/team-workflow.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { mapErrorToResponse } from "@/lib/team-route-helpers"

const createSchema = z.object({
  patientId: z.number().int().positive(),
  toUserId: z.number().int().positive(),
  action: z.string().min(1).max(80),
  payload: z.unknown().optional(),
})

export async function GET(req: NextRequest) {
  try {
    const user = requireRole(req, "DOCTOR")
    const ctx = extractRequestContext(req)
    const items = await delegationRequestService.listInbox(user.id, ctx)
    return NextResponse.json({ items })
  } catch (e) {
    return mapErrorToResponse(e, "team/delegations GET")
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
    const row = await delegationRequestService.create(
      {
        patientId: parsed.data.patientId,
        fromUserId: user.id,
        toUserId: parsed.data.toUserId,
        action: parsed.data.action,
        // z.unknown() is loose by design; the service treats it as InputJsonValue.
        payload: parsed.data.payload as never,
      },
      ctx,
    )
    return NextResponse.json(row, { status: 201 })
  } catch (e) {
    return mapErrorToResponse(e, "team/delegations POST")
  }
}
