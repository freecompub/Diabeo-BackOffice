/**
 * @route POST /api/patients/[id]/devices/[deviceId]/sync-ping
 * @description H1 (review re-1 PR #408) — alimente PatientDevice.lastSyncAt.
 *
 * Appelé par l'app patient mobile en heartbeat (post-sync CGM, etc.)
 * ou par le soignant en force manuelle (UI debug).
 *
 * Body optionnel : `{ batteryLevel?: 0-100, sensorExpiresAt?: ISO }`.
 * Si body vide, juste UPDATE lastSyncAt = NOW().
 *
 * RBAC : VIEWER own / NURSE+ cabinet.
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import {
  auditedRequireRole,
  mapErrorToResponse,
  assertJsonContentType,
  assertBodySize,
} from "@/lib/team-route-helpers"
import { requireGdprConsent } from "@/lib/gdpr"
import {
  deviceSupervisionService,
  DeviceSupervisionAccessError,
  DeviceSupervisionNotFoundError,
  DeviceSupervisionValidationError,
  SUPERVISION_BOUNDS,
} from "@/lib/services/device-supervision.service"

const MAX_BODY_BYTES = 10_000

const paramsSchema = z.object({
  id: z.coerce.number().int().positive(),
  deviceId: z.coerce.number().int().positive(),
})

// NEW-H1 (review re-2) — Zod fail-fast sur sensorExpiresAt :
// `.min(2020-01-01)` exclu les forgeries `1970` ;
// `.max(now+365j)` exclu les `9999-12-31` qui désactiveraient les
// alertes proche-expiration côté dashboard NURSE+. Validation
// dupliquée service-side via SUPERVISION_BOUNDS pour defense-in-depth.
const pingBodySchema = z.object({
  batteryLevel: z.number().int().min(0).max(100).nullable().optional(),
  sensorExpiresAt: z.coerce.date()
    .min(SUPERVISION_BOUNDS.SENSOR_EXPIRES_MIN_DATE, "sensorExpiresAt.tooOld")
    .nullable()
    .optional()
    .refine(
      (d) => d == null || d.getTime() <= Date.now() + SUPERVISION_BOUNDS.SENSOR_EXPIRES_MAX_FUTURE_DAYS * 86_400_000,
      { message: "sensorExpiresAt.tooFar" },
    ),
}).optional()

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; deviceId: string }> },
) {
  const ctx = extractRequestContext(req)
  try {
    const ctErr = assertJsonContentType(req)
    if (ctErr) return ctErr
    const sizeErr = assertBodySize(req, MAX_BODY_BYTES)
    if (sizeErr) return sizeErr

    const raw = await params
    const parsedParams = paramsSchema.safeParse(raw)
    if (!parsedParams.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }
    const user = await auditedRequireRole(
      req, "VIEWER", ctx, "DEVICE", String(parsedParams.data.deviceId),
    )
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
    }

    // Body optionnel : un sync-ping sans données reste valide
    // (juste UPDATE lastSyncAt = NOW()).
    let payload: { batteryLevel?: number | null; sensorExpiresAt?: Date | null } = {}
    const rawBody = await req.text()
    if (rawBody.trim() !== "") {
      let bodyJson: unknown
      try {
        bodyJson = JSON.parse(rawBody)
      } catch {
        return NextResponse.json({ error: "invalidJSON" }, { status: 400 })
      }
      const parsedBody = pingBodySchema.safeParse(bodyJson)
      if (!parsedBody.success) {
        return NextResponse.json(
          { error: "validationFailed", details: parsedBody.error.flatten().fieldErrors },
          { status: 400 },
        )
      }
      payload = parsedBody.data ?? {}
    }

    try {
      const device = await deviceSupervisionService.recordSyncPing(
        parsedParams.data.id,
        parsedParams.data.deviceId,
        payload,
        user.id, user.role, ctx,
      )
      return NextResponse.json({ device })
    } catch (e) {
      if (e instanceof DeviceSupervisionAccessError) {
        try {
          await auditService.accessDenied({
            userId: user.id,
            resource: "DEVICE",
            resourceId: String(parsedParams.data.deviceId),
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            requestId: ctx.requestId,
            metadata: { patientId: parsedParams.data.id, reason: e.message },
          })
        } catch { /* swallow */ }
        return NextResponse.json({ error: "forbidden" }, { status: 403 })
      }
      throw e
    }
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    if (e instanceof DeviceSupervisionNotFoundError) {
      return NextResponse.json({ error: "notFound" }, { status: 404 })
    }
    if (e instanceof DeviceSupervisionValidationError) {
      return NextResponse.json({ error: "validationFailed", field: e.field }, { status: 422 })
    }
    return mapErrorToResponse(e, "patients/:id/devices/:deviceId/sync-ping POST", ctx.requestId)
  }
}
