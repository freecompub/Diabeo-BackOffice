/**
 * @route /api/patients/[id]/activity
 * @description Groupe 6 Batch 1 — Journal activité physique (US-2059).
 *   - GET  : liste paginée par patient (VIEWER own / NURSE+ cabinet)
 *   - POST : crée une entrée manuelle (`activitySource = manual`)
 *
 * C2 (review PR #407) — `requireGdprConsent` sur tous les paths,
 * activité physique = données de santé RGPD Art. 9.
 * M8 (review PR #407) — `accessDenied` audit émis sur
 * `ActivityAccessError` pour US-2265 burst detection.
 * C3 (review PR #407) — `eventDate` borné [now-2y, now+5min].
 * H4 (review PR #407) — body size cap 1 MB.
 * H5 (review PR #407) — refine from <= to.
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

const MAX_BODY_BYTES = 1_000_000

const paramsSchema = z.object({ id: z.coerce.number().int().positive() })

const listQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().positive().max(500).default(50),
  cursor: z.string().uuid().optional(),
}).refine((d) => !d.from || !d.to || d.from <= d.to, {
  message: "from must be <= to",
})

// C3 — bornes eventDate.
const eventDateMin = (): Date => new Date(
  Date.now() - ACTIVITY_BOUNDS.EVENT_DATE_LOOKBACK_DAYS * 86_400_000,
)
const eventDateMax = (): Date => new Date(
  Date.now() + ACTIVITY_BOUNDS.EVENT_DATE_FUTURE_SKEW_MS,
)

const activityInputSchema = z.object({
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

/**
 * M8 helper — émet un `accessDenied` audit row sur erreur RBAC
 * service-level (cohérent avec `mapErrorToResponse` pour ForbiddenError).
 */
async function emitAccessDenied(
  userId: number,
  patientIdRaw: string | number,
  ctx: { ipAddress: string; userAgent: string; requestId: string },
  reason: string,
): Promise<void> {
  try {
    await auditService.accessDenied({
      userId,
      resource: "ACTIVITY",
      resourceId: String(patientIdRaw),
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      metadata: {
        patientId: typeof patientIdRaw === "number" ? patientIdRaw : undefined,
        reason,
      },
    })
  } catch {
    // swallow — audit failure ne doit pas bloquer la réponse
  }
}

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
      req, "VIEWER", ctx, "ACTIVITY", String(parsedParams.data.id),
    )
    // C2 — consent RGPD obligatoire avant accès données santé.
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
    }
    try {
      const items = await activityService.listByPatient(
        parsedParams.data.id, parsedQuery.data, user.id, user.role, ctx,
      )
      return NextResponse.json({ items })
    } catch (e) {
      if (e instanceof ActivityAccessError) {
        await emitAccessDenied(user.id, parsedParams.data.id, ctx, e.message)
        return NextResponse.json({ error: "forbidden" }, { status: 403 })
      }
      throw e
    }
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
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
    // H4 — body size cap avant tout work.
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
    const parsedBody = activityInputSchema.safeParse(body)
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsedBody.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    try {
      const activity = await activityService.create(
        parsedParams.data.id, parsedBody.data, user.id, user.role, ctx,
      )
      return NextResponse.json({ activity }, { status: 201 })
    } catch (e) {
      if (e instanceof ActivityAccessError) {
        await emitAccessDenied(user.id, parsedParams.data.id, ctx, e.message)
        return NextResponse.json({ error: "forbidden" }, { status: 403 })
      }
      throw e
    }
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    if (e instanceof ActivityValidationError) {
      return NextResponse.json({ error: "validationFailed", field: e.field }, { status: 422 })
    }
    if (e instanceof ActivityNotFoundError) {
      return NextResponse.json({ error: "notFound" }, { status: 404 })
    }
    return mapErrorToResponse(e, "patients/:id/activity POST", ctx.requestId)
  }
}
