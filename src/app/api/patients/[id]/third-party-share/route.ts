/**
 * Groupe 10 Batch D — US-2240 third-party-share (école, EHPAD, etc).
 * GET — active version + parsed snapshot. NURSE+.
 * PUT — NURSE crée draft (status=active, validatedAt=null). DOCTOR valide
 *   ensuite via `/api/patient/modes/validate` (reuse PR #396 workflow).
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import {
  thirdPartyShareService, thirdPartyShareSchema, ShareValidationError,
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
        metadata: { patientId, endpoint: "third-party-share.get" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
    }
    const out = await thirdPartyShareService.getActive(patientId, user.id, ctx)
    return NextResponse.json(out)
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "patients/[id]/third-party-share GET", ctx.requestId)
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
    const user = await auditedRequireRole(req, "NURSE", ctx, "CONFIG_VERSION", String(patientId))
    const allowed = await canAccessPatient(user.id, user.role, patientId)
    if (!allowed) {
      await auditService.accessDenied({
        userId: user.id, resource: "CONFIG_VERSION", resourceId: String(patientId),
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        metadata: { patientId, endpoint: "third-party-share.upsert" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
    }
    const body = await req.json()
    const parsedBody = thirdPartyShareSchema.safeParse(body)
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsedBody.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    try {
      const version = await thirdPartyShareService.upsert(
        patientId, parsedBody.data, user.id, ctx,
      )
      return NextResponse.json(version, { status: 201 })
    } catch (innerErr) {
      if (innerErr instanceof ShareValidationError) {
        return NextResponse.json(
          { error: "validationFailed", field: innerErr.field },
          { status: 422 },
        )
      }
      throw innerErr
    }
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "patients/[id]/third-party-share PUT", ctx.requestId)
  }
}
