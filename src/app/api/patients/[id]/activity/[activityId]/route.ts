/**
 * @route /api/patients/[id]/activity/[activityId]
 * @description PUT / DELETE sur une entrée d'activité physique.
 *
 * Note métier (US-2059) : les entries issues d'un capteur mobile
 * (`activitySource ≠ manual`) sont **immutables** côté service —
 * un PUT lève `validationFailed:immutableSource:*`. Pour les corriger,
 * il faut DELETE + re-créer.
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { extractRequestContext } from "@/lib/services/audit.service"
import {
  auditedRequireRole,
  mapErrorToResponse,
  assertJsonContentType,
} from "@/lib/team-route-helpers"
import {
  activityService,
  ActivityValidationError,
  ActivityAccessError,
  ActivityNotFoundError,
  ACTIVITY_BOUNDS,
  ACTIVITY_TYPES,
} from "@/lib/services/activity.service"

const paramsSchema = z.object({
  id: z.coerce.number().int().positive(),
  activityId: z.string().uuid(),
})

const updateSchema = z.object({
  eventDate: z.coerce.date().optional(),
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
  comment: z.string().trim().max(ACTIVITY_BOUNDS.MAX_COMMENT_LEN).nullable().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: "no fields to update" })

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; activityId: string }> },
) {
  const ctx = extractRequestContext(req)
  try {
    const ctErr = assertJsonContentType(req)
    if (ctErr) return ctErr

    const raw = await params
    const parsedParams = paramsSchema.safeParse(raw)
    if (!parsedParams.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }
    const user = await auditedRequireRole(
      req, "VIEWER", ctx, "ACTIVITY", parsedParams.data.activityId,
    )
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: "invalidJSON" }, { status: 400 })
    const parsedBody = updateSchema.safeParse(body)
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsedBody.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const activity = await activityService.update(
      parsedParams.data.activityId, parsedBody.data, user.id, user.role, ctx,
    )
    return NextResponse.json({ activity })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    if (e instanceof ActivityNotFoundError) {
      return NextResponse.json({ error: "notFound" }, { status: 404 })
    }
    if (e instanceof ActivityValidationError) {
      return NextResponse.json({ error: "validationFailed", field: e.field }, { status: 422 })
    }
    if (e instanceof ActivityAccessError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
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
    await activityService.delete(parsedParams.data.activityId, user.id, user.role, ctx)
    return new NextResponse(null, { status: 204 })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    if (e instanceof ActivityNotFoundError) {
      return NextResponse.json({ error: "notFound" }, { status: 404 })
    }
    if (e instanceof ActivityAccessError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    return mapErrorToResponse(e, "patients/:id/activity/:activityId DELETE", ctx.requestId)
  }
}
