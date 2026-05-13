/** US-2080 — Mark a resource as read by the caller (idempotent). */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole } from "@/lib/auth"
import { readReceiptService } from "@/lib/services/team-workflow.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { mapErrorToResponse } from "@/lib/team-route-helpers"

const schema = z.object({
  resource: z.string().min(1).max(40),
  resourceId: z.number().int().positive(),
})

export async function POST(req: NextRequest) {
  try {
    const user = requireRole(req, "NURSE")
    const ctx = extractRequestContext(req)
    const body = await req.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }
    const r = await readReceiptService.markRead(
      parsed.data.resource, parsed.data.resourceId, user.id, ctx,
    )
    return NextResponse.json(r)
  } catch (e) {
    return mapErrorToResponse(e, "team/read-receipts POST")
  }
}
