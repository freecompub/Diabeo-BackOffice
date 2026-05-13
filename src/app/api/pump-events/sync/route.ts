/**
 * US-2043 — Bulk sync pump events.
 *
 * POST `/api/pump-events/sync` { patientId, events: [{timestamp, eventType, data}] }
 * NURSE+ + canAccessPatient + patient consent.
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { patientShareConsent } from "@/lib/consent"
import { pumpEventService } from "@/lib/services/insulin-meals.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

const schema = z.object({
  patientId: z.number().int().positive(),
  events: z.array(z.object({
    timestamp: z.coerce.date(),
    eventType: z.string().min(1).max(50),
    data: z.unknown().optional(),
  })).min(1).max(1000),
})

export async function POST(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const body = await req.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const user = await auditedRequireRole(req, "NURSE", ctx, "PUMP_EVENT", String(parsed.data.patientId))

    const allowed = await canAccessPatient(user.id, user.role, parsed.data.patientId)
    if (!allowed) {
      await auditService.accessDenied({
        userId: user.id, resource: "PUMP_EVENT", resourceId: String(parsed.data.patientId),
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        metadata: { patientId: parsed.data.patientId, endpoint: "bulk-sync" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    const consent = await patientShareConsent(parsed.data.patientId)
    if (!consent.ok) return NextResponse.json({ error: consent.error }, { status: consent.status })

    const out = await pumpEventService.bulkSync(
      parsed.data.patientId,
      parsed.data.events.map((e) => ({
        timestamp: e.timestamp,
        eventType: e.eventType,
        data: e.data as never,
      })),
      user.id, ctx,
    )
    return NextResponse.json(out, { status: 201 })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "pump-events/sync POST", ctx.requestId)
  }
}
