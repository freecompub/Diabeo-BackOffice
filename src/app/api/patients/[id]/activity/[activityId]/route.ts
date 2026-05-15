/**
 * @route /api/patients/[id]/activity/[activityId]
 * @description PUT / DELETE sur une entrée d'activité physique.
 *
 * Note (US-2059) : les entries issues d'un capteur mobile
 * (`activitySource ≠ manual`) sont **immutables** côté service —
 * PUT lève `validationFailed:immutableSource:*`. H3 (review PR #407) :
 * DELETE également bloqué sur sensor entries (symétrie defense-in-depth
 * contre bypass DELETE-then-CREATE-modifié).
 *
 * C2 + M8 + H4 alignés sur route.ts.
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
  ActivityNotFoundError,
  ACTIVITY_BOUNDS,
  ACTIVITY_TYPES,
} from "@/lib/services/activity.service"

const MAX_BODY_BYTES = 200_000

const paramsSchema = z.object({
  id: z.coerce.number().int().positive(),
  activityId: z.string().uuid(),
})

const eventDateMin = (): Date => new Date(
  Date.now() - ACTIVITY_BOUNDS.EVENT_DATE_LOOKBACK_DAYS * 86_400_000,
)
const eventDateMax = (): Date => new Date(
  Date.now() + ACTIVITY_BOUNDS.EVENT_DATE_FUTURE_SKEW_MS,
)

const updateSchema = z.object({
  eventDate: z.coerce.date().refine(
    (d) => d >= eventDateMin() && d <= eventDateMax(),
    { message: "eventDate out of allowed window" },
  ).optional(),
  activityType: z.enum(ACTIVITY_TYPES).optional(),
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
}).refine(
  // M2 (review PR #407) — au moins un champ doit être présent.
  // Avec Zod `.optional()`, les undefined sont omis du parsed output ;
  // `null` reste présent et signifie "effacer le champ".
  // `{}` → 0 keys → rejeté ; `{ comment: null }` → 1 key → accepté.
  (d) => Object.keys(d).length > 0,
  { message: "at least one field required" },
)

async function emitAccessDenied(
  userId: number,
  resourceId: string,
  patientHint: number | undefined,
  ctx: { ipAddress: string; userAgent: string; requestId: string },
  reason: string,
): Promise<void> {
  try {
    await auditService.accessDenied({
      userId,
      resource: "ACTIVITY",
      resourceId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      metadata: {
        ...(patientHint ? { patientId: patientHint } : {}),
        reason,
      },
    })
  } catch { /* swallow */ }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; activityId: string }> },
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
      req, "VIEWER", ctx, "ACTIVITY", parsedParams.data.activityId,
    )
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
    }

    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: "invalidJSON" }, { status: 400 })
    const parsedBody = updateSchema.safeParse(body)
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsedBody.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    try {
      const activity = await activityService.update(
        parsedParams.data.activityId, parsedBody.data, user.id, user.role, ctx,
      )
      return NextResponse.json({ activity })
    } catch (e) {
      if (e instanceof ActivityAccessError) {
        await emitAccessDenied(
          user.id, parsedParams.data.activityId,
          parsedParams.data.id, ctx, e.message,
        )
        return NextResponse.json({ error: "forbidden" }, { status: 403 })
      }
      throw e
    }
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    if (e instanceof ActivityNotFoundError) {
      return NextResponse.json({ error: "notFound" }, { status: 404 })
    }
    if (e instanceof ActivityValidationError) {
      return NextResponse.json({ error: "validationFailed", field: e.field }, { status: 422 })
    }
    return mapErrorToResponse(e, "patients/:id/activity/:activityId PUT", ctx.requestId)
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; activityId: string }> },
) {
  const ctx = extractRequestContext(req)
  try {
    const raw = await params
    const parsedParams = paramsSchema.safeParse(raw)
    if (!parsedParams.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }
    const user = await auditedRequireRole(
      req, "VIEWER", ctx, "ACTIVITY", parsedParams.data.activityId,
    )
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
    }
    try {
      await activityService.delete(parsedParams.data.activityId, user.id, user.role, ctx)
      return new NextResponse(null, { status: 204 })
    } catch (e) {
      if (e instanceof ActivityAccessError) {
        await emitAccessDenied(
          user.id, parsedParams.data.activityId,
          parsedParams.data.id, ctx, e.message,
        )
        return NextResponse.json({ error: "forbidden" }, { status: 403 })
      }
      throw e
    }
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    if (e instanceof ActivityNotFoundError) {
      return NextResponse.json({ error: "notFound" }, { status: 404 })
    }
    if (e instanceof ActivityValidationError) {
      // H3 — DELETE sur sensor entry lève `immutableSource:*`.
      return NextResponse.json({ error: "validationFailed", field: e.field }, { status: 422 })
    }
    return mapErrorToResponse(e, "patients/:id/activity/:activityId DELETE", ctx.requestId)
  }
}
