/**
 * Groupe 10 Batch D — US-2261 cancel scheduled message.
 * DELETE — DOCTOR cancel un message programmé (set isActive=false).
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { scheduledMessagesService } from "@/lib/services/scheduled-messages.service"
import {
  auditService, extractRequestContext,
} from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

const paramsSchema = z.object({
  id: z.coerce.number().int().positive(),
  notifId: z.string().min(1).max(64),
})

type RouteCtx = { params: Promise<{ id: string; notifId: string }> }

export async function DELETE(req: NextRequest, { params }: RouteCtx) {
  const ctx = extractRequestContext(req)
  try {
    const parsed = paramsSchema.safeParse(await params)
    if (!parsed.success) {
      return NextResponse.json({ error: "invalidParams" }, { status: 400 })
    }
    const { id: patientId, notifId } = parsed.data
    const user = await auditedRequireRole(req, "DOCTOR", ctx, "PUSH_SCHEDULED_NOTIFICATION", notifId)
    const allowed = await canAccessPatient(user.id, user.role, patientId)
    if (!allowed) {
      await auditService.accessDenied({
        userId: user.id, resource: "PUSH_SCHEDULED_NOTIFICATION", resourceId: notifId,
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        metadata: { patientId, endpoint: "scheduled-messages.cancel" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    const out = await scheduledMessagesService.cancel(
      notifId, patientId, user.id, ctx,
    )
    return NextResponse.json(out)
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "patients/[id]/scheduled-messages/[notifId] DELETE", ctx.requestId)
  }
}
