/**
 * @route /api/patients/[id]/activity
 * @description Groupe 6 Batch 1 — Journal activité physique (US-2059).
 *   - GET  : liste paginée par patient (VIEWER own / NURSE+ cabinet)
 *   - POST : crée une entrée manuelle (`activitySource = manual`)
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

const paramsSchema = z.object({ id: z.coerce.number().int().positive() })

const listQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
  cursor: z.string().uuid().optional(),
})

const activityInputSchema = z.object({
  eventDate: z.coerce.date(),
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
  comment: z.string().trim().max(ACTIVITY_BOUNDS.MAX_COMMENT_LEN).nullable().optional(),
})

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = extractRequestContext(req)
  try {
    const raw = await params
    const parsedParams = paramsSchema.safeParse(raw)
    if (!parsedParams.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }
    const parsedQuery = listQuerySchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams.entries()),
    )
    if (!parsedQuery.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsedQuery.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const user = await auditedRequireRole(
      req, "VIEWER", ctx, "ACTIVITY", `patient:${parsedParams.data.id}`,
    )
    const items = await activityService.listByPatient(
      parsedParams.data.id, parsedQuery.data, user.id, user.role, ctx,
    )
    return NextResponse.json({ items })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    if (e instanceof ActivityAccessError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    return mapErrorToResponse(e, "patients/:id/activity GET", ctx.requestId)
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
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
      req, "VIEWER", ctx, "ACTIVITY", `patient:${parsedParams.data.id}`,
    )
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: "invalidJSON" }, { status: 400 })
    const parsedBody = activityInputSchema.safeParse(body)
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsedBody.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const activity = await activityService.create(
      parsedParams.data.id, parsedBody.data, user.id, user.role, ctx,
    )
    return NextResponse.json({ activity }, { status: 201 })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    if (e instanceof ActivityValidationError) {
      return NextResponse.json({ error: "validationFailed", field: e.field }, { status: 422 })
    }
    if (e instanceof ActivityAccessError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    if (e instanceof ActivityNotFoundError) {
      return NextResponse.json({ error: "notFound" }, { status: 404 })
    }
    return mapErrorToResponse(e, "patients/:id/activity POST", ctx.requestId)
  }
}
