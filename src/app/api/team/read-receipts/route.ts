/** US-2080 — Mark a resource as read (review PR #390 H1 + H9). */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { readReceiptService } from "@/lib/services/team-workflow.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

const schema = z.object({
  resource: z.enum(["ANNOUNCEMENT", "DELEGATION_REQUEST", "HANDOFF_NOTE"]),
  resourceId: z.number().int().positive(),
})

export async function POST(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const body = await req.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }
    const user = await auditedRequireRole(
      req, "NURSE", ctx, "READ_RECEIPT",
      `${parsed.data.resource}:${parsed.data.resourceId}`,
    )
    const r = await readReceiptService.markRead(
      parsed.data.resource, parsed.data.resourceId, user.id, ctx,
    )
    return NextResponse.json(r)
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "team/read-receipts POST", ctx.requestId)
  }
}
