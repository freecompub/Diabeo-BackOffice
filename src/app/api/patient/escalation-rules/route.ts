/** US-2219 — Escalation rules for patient emergency workflow. */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { EscalationTargetType } from "@prisma/client"
import { AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { resolvePatientIdFromQuery } from "@/lib/auth/query-helpers"
import { escalationRuleService } from "@/lib/services/mirror-v1-config.service"
import {
  auditService, extractRequestContext,
} from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

const upsertSchema = z.object({
  rules: z.array(z.object({
    priority: z.number().int().min(1).max(10),
    targetType: z.enum(EscalationTargetType),
    targetId: z.number().int().positive().nullable(),
    delayMinutes: z.number().int().min(0).max(60),
  })).min(1).max(10),
})

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const user = await auditedRequireRole(req, "VIEWER", ctx, "ESCALATION_RULE", "list")
    const res = await resolvePatientIdFromQuery(req, user.id, user.role)
    if (res.error) return NextResponse.json({ error: res.error }, { status: res.error === "invalidPatientId" ? 400 : 404 })
    const out = await escalationRuleService.list(res.patientId, user.id, ctx)
    return NextResponse.json(out)
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "escalation-rules GET", ctx.requestId)
  }
}

export async function PUT(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const user = await auditedRequireRole(req, "NURSE", ctx, "ESCALATION_RULE", "upsert")
    const body = await req.json()
    const parsed = upsertSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const res = await resolvePatientIdFromQuery(req, user.id, user.role)
    if (res.error) return NextResponse.json({ error: res.error }, { status: res.error === "invalidPatientId" ? 400 : 404 })
    const allowed = await canAccessPatient(user.id, user.role, res.patientId)
    if (!allowed) {
      await auditService.accessDenied({
        userId: user.id, resource: "ESCALATION_RULE", resourceId: String(res.patientId),
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        metadata: { patientId: res.patientId, endpoint: "upsert" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    const out = await escalationRuleService.upsert(res.patientId, parsed.data.rules, user.id, ctx)
    return NextResponse.json(out, { status: 201 })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "escalation-rules PUT", ctx.requestId)
  }
}
