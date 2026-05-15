/**
 * Groupe 10 Batch D — US-2261 messages programmés patient.
 * GET — liste messages programmés actifs du patient.
 * POST — DOCTOR programme un message one-shot.
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { scheduledMessagesService } from "@/lib/services/scheduled-messages.service"
import {
  auditService, extractRequestContext,
} from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

const paramsSchema = z.object({ id: z.coerce.number().int().positive() })

// M6 (re-review) — bound scheduledAt at now+1y to prevent year-9999 schedules
//   (cron worker DoS) ; cap templateVariables at 4 KB stringified to bound
//   payload size on push delivery.
const MAX_SCHEDULE_HORIZON_MS = 365 * 86_400_000
const MAX_TEMPLATE_VARS_BYTES = 4096

const scheduleSchema = z.object({
  templateId: z.string().min(1).max(50),
  scheduledAt: z.coerce.date()
    .refine((d) => d.getTime() > Date.now(), {
      message: "scheduledAt must be in the future",
    })
    .refine((d) => d.getTime() <= Date.now() + MAX_SCHEDULE_HORIZON_MS, {
      message: "scheduledAt must be within 1 year",
    }),
  templateVariables: z.record(z.string(), z.unknown())
    .optional()
    .refine((v) => {
      if (!v) return true
      return JSON.stringify(v).length <= MAX_TEMPLATE_VARS_BYTES
    }, { message: "templateVariables exceeds 4KB" }),
  expiresAt: z.coerce.date().optional(),
})

type RouteCtx = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: RouteCtx) {
  const ctx = extractRequestContext(req)
  try {
    const parsed = paramsSchema.safeParse(await params)
    if (!parsed.success) {
      return NextResponse.json({ error: "invalidPatientId" }, { status: 400 })
    }
    const patientId = parsed.data.id
    const user = await auditedRequireRole(req, "NURSE", ctx, "PUSH_SCHEDULED_NOTIFICATION", String(patientId))
    const allowed = await canAccessPatient(user.id, user.role, patientId)
    if (!allowed) {
      await auditService.accessDenied({
        userId: user.id, resource: "PUSH_SCHEDULED_NOTIFICATION", resourceId: String(patientId),
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        metadata: { patientId, endpoint: "scheduled-messages.list" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
    }
    const items = await scheduledMessagesService.listForPatient(
      patientId, user.id, {}, ctx,
    )
    return NextResponse.json({ items })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "patients/[id]/scheduled-messages GET", ctx.requestId)
  }
}

export async function POST(req: NextRequest, { params }: RouteCtx) {
  const ctx = extractRequestContext(req)
  try {
    const parsed = paramsSchema.safeParse(await params)
    if (!parsed.success) {
      return NextResponse.json({ error: "invalidPatientId" }, { status: 400 })
    }
    const patientId = parsed.data.id
    const user = await auditedRequireRole(req, "DOCTOR", ctx, "PUSH_SCHEDULED_NOTIFICATION", String(patientId))
    const allowed = await canAccessPatient(user.id, user.role, patientId)
    if (!allowed) {
      await auditService.accessDenied({
        userId: user.id, resource: "PUSH_SCHEDULED_NOTIFICATION", resourceId: String(patientId),
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        metadata: { patientId, endpoint: "scheduled-messages.schedule" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
    }
    const body = await req.json()
    const parsedBody = scheduleSchema.safeParse(body)
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsedBody.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const item = await scheduledMessagesService.schedule(
      patientId, parsedBody.data, user.id, ctx,
    )
    return NextResponse.json({ item }, { status: 201 })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "patients/[id]/scheduled-messages POST", ctx.requestId)
  }
}
