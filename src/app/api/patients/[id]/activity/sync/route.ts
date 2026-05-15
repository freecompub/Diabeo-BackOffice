/**
 * @route POST /api/patients/[id]/activity/sync
 * @description Groupe 6 Batch 1 — Bulk sync mobile (US-2060 / 2061).
 *
 * L'app iOS (HealthKit) ou Android (Google Fit / Health Connect) pousse
 * un batch d'entrées avec `externalSyncId` propre à chaque sample. Le
 * service dédupliquera silencieusement via la contrainte UNIQUE PARTIAL.
 *
 * RBAC : VIEWER (patient depuis son app) sync uniquement son propre
 * patient ; NURSE+ peut sync pour n'importe quel patient du cabinet.
 *
 * Réponse : `{ inserted, skipped }` pour transparence côté app mobile.
 *
 * C2 + M8 + H4 + C3 alignés sur route.ts.
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
  activityService,
  ActivityValidationError,
  ActivityAccessError,
  ACTIVITY_BOUNDS,
  ACTIVITY_TYPES,
} from "@/lib/services/activity.service"

// Bulk sync : cap à ~5 MB (500 items × 10 KB max each).
const MAX_BODY_BYTES = 5_000_000

const paramsSchema = z.object({ id: z.coerce.number().int().positive() })

const eventDateMin = (): Date => new Date(
  Date.now() - ACTIVITY_BOUNDS.EVENT_DATE_LOOKBACK_DAYS * 86_400_000,
)
const eventDateMax = (): Date => new Date(
  Date.now() + ACTIVITY_BOUNDS.EVENT_DATE_FUTURE_SKEW_MS,
)

const syncItemSchema = z.object({
  externalSyncId: z.string().trim().min(1).max(ACTIVITY_BOUNDS.MAX_EXTERNAL_SYNC_ID_LEN),
  eventDate: z.coerce.date().refine(
    (d) => d >= eventDateMin() && d <= eventDateMax(),
    { message: "eventDate out of allowed window" },
  ),
  activityType: z.enum(ACTIVITY_TYPES),
  activityDuration: z.number().int().min(0).max(ACTIVITY_BOUNDS.MAX_DURATION_MIN).nullable().optional(),
  activityIntensity: z.enum(["light", "moderate", "intense"]).nullable().optional(),
  activitySteps: z.number().int().min(0).max(ACTIVITY_BOUNDS.MAX_STEPS).nullable().optional(),
  activityDistanceM: z.number().int().min(0).max(ACTIVITY_BOUNDS.MAX_DISTANCE_M).nullable().optional(),
  activityCalories: z.number().int().min(0).max(ACTIVITY_BOUNDS.MAX_CALORIES).nullable().optional(),
  activityHeartRateAvg: z.number().int()
    .min(ACTIVITY_BOUNDS.MIN_HEART_RATE_BPM)
    .max(ACTIVITY_BOUNDS.MAX_HEART_RATE_BPM)
    .nullable().optional(),
  comment: z.string().max(ACTIVITY_BOUNDS.MAX_COMMENT_LEN).nullable().optional(),
})

const syncBodySchema = z.object({
  source: z.enum(["healthkit", "google_fit", "health_connect"]),
  items: z.array(syncItemSchema).min(1).max(ACTIVITY_BOUNDS.MAX_BULK_ITEMS),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
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
      req, "VIEWER", ctx, "ACTIVITY", String(parsedParams.data.id),
    )
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
    }

    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: "invalidJSON" }, { status: 400 })
    const parsedBody = syncBodySchema.safeParse(body)
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsedBody.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    try {
      const result = await activityService.bulkSync(
        parsedParams.data.id,
        parsedBody.data.source,
        parsedBody.data.items,
        user.id, user.role, ctx,
      )
      return NextResponse.json(result)
    } catch (e) {
      if (e instanceof ActivityAccessError) {
        try {
          await auditService.accessDenied({
            userId: user.id,
            resource: "ACTIVITY",
            resourceId: String(parsedParams.data.id),
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            requestId: ctx.requestId,
            metadata: {
              patientId: parsedParams.data.id,
              reason: e.message,
              syncSource: parsedBody.data.source,
            },
          })
        } catch { /* swallow */ }
        return NextResponse.json({ error: "forbidden" }, { status: 403 })
      }
      throw e
    }
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    if (e instanceof ActivityValidationError) {
      return NextResponse.json({ error: "validationFailed", field: e.field }, { status: 422 })
    }
    return mapErrorToResponse(e, "patients/:id/activity/sync POST", ctx.requestId)
  }
}
