/**
 * US-2086 — Handoff notes.
 *
 * Review PR #390 :
 *  - C2 : `canAccessPatient` + `patientShareConsent` avant write.
 *  - H1 : `auditedRequireRole` (accessDenied sur 403 RBAC).
 *  - H6 : `listInbox` filtre RGPD côté service.
 *  - H8 : `toUserId` colleague-validation côté service.
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { patientShareConsent } from "@/lib/consent"
import { handoffNoteService } from "@/lib/services/team-workflow.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

const createSchema = z.object({
  patientId: z.number().int().positive(),
  toUserId: z.number().int().positive(),
  note: z.string().min(1).max(4096),
})

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const user = await auditedRequireRole(req, "NURSE", ctx, "HANDOFF_NOTE", "inbox")
    const items = await handoffNoteService.listInbox(user.id, ctx)
    return NextResponse.json({ items })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "team/handoffs GET", ctx.requestId)
  }
}

export async function POST(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const user = await auditedRequireRole(req, "NURSE", ctx, "HANDOFF_NOTE", "create")
    const body = await req.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    // C2 — caller must have access to the target patient.
    const allowed = await canAccessPatient(user.id, user.role, parsed.data.patientId)
    if (!allowed) {
      await auditService.accessDenied({
        userId: user.id, resource: "HANDOFF_NOTE",
        resourceId: String(parsed.data.patientId),
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        metadata: { patientId: parsed.data.patientId, endpoint: "create" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    const consent = await patientShareConsent(parsed.data.patientId)
    if (!consent.ok) return NextResponse.json({ error: consent.error }, { status: consent.status })

    const out = await handoffNoteService.create(
      {
        patientId: parsed.data.patientId,
        fromUserId: user.id,
        toUserId: parsed.data.toUserId,
        note: parsed.data.note,
      },
      ctx,
    )
    return NextResponse.json(out, { status: 201 })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "team/handoffs POST", ctx.requestId)
  }
}
