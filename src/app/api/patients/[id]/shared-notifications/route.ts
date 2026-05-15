/**
 * Groupe 10 Batch D — US-2242 shared notifications routing.
 * GET/PUT — matrice alertType × caregivers. DOCTOR upsert (clinical config),
 * NURSE read-only car ce sont des règles de notification.
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import {
  sharedNotificationsService, sharedNotificationsSchema,
} from "@/lib/services/share-config.service"
import {
  auditService, extractRequestContext,
} from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

const paramsSchema = z.object({ id: z.coerce.number().int().positive() })

type RouteCtx = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: RouteCtx) {
  const ctx = extractRequestContext(req)
  try {
    const parsed = paramsSchema.safeParse(await params)
    if (!parsed.success) {
      return NextResponse.json({ error: "invalidPatientId" }, { status: 400 })
    }
    const patientId = parsed.data.id
    const user = await auditedRequireRole(req, "NURSE", ctx, "CONFIG_VERSION", String(patientId))
    const allowed = await canAccessPatient(user.id, user.role, patientId)
    if (!allowed) {
      await auditService.accessDenied({
        userId: user.id, resource: "CONFIG_VERSION", resourceId: String(patientId),
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        metadata: { patientId, endpoint: "shared-notifications.get" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
    }
    const out = await sharedNotificationsService.getActive(patientId, user.id, ctx)
    return NextResponse.json(out)
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "patients/[id]/shared-notifications GET", ctx.requestId)
  }
}

export async function PUT(req: NextRequest, { params }: RouteCtx) {
  const ctx = extractRequestContext(req)
  try {
    const parsed = paramsSchema.safeParse(await params)
    if (!parsed.success) {
      return NextResponse.json({ error: "invalidPatientId" }, { status: 400 })
    }
    const patientId = parsed.data.id
    // DOCTOR-only for write : config de routing affecte les destinataires.
    const user = await auditedRequireRole(req, "DOCTOR", ctx, "CONFIG_VERSION", String(patientId))
    const allowed = await canAccessPatient(user.id, user.role, patientId)
    if (!allowed) {
      await auditService.accessDenied({
        userId: user.id, resource: "CONFIG_VERSION", resourceId: String(patientId),
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        metadata: { patientId, endpoint: "shared-notifications.upsert" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
    }
    const body = await req.json()
    const parsedBody = sharedNotificationsSchema.safeParse(body)
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsedBody.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const version = await sharedNotificationsService.upsert(
      patientId, parsedBody.data, user.id, ctx,
    )
    return NextResponse.json(version, { status: 201 })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "patients/[id]/shared-notifications PUT", ctx.requestId)
  }
}
