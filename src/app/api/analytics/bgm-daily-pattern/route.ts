/**
 * US-2639 — GET /api/analytics/bgm-daily-pattern
 *
 * Carnet glycémie **capillaire** (patient sans capteur) : moyenne des relevés
 * par moment de la journée (Nuit / Matin / Midi / Soir) — remplace l'AGP, non
 * calculable sans capteur. Sert les deux contrats (`?patientId=` page / cTok
 * drawer). Gardes alignées sur les autres routes analytics per-patient. Lecture
 * `READ GLYCEMIA_ENTRY` scopée + auditée dans le service
 * (`kind="bgmDailyPattern"`, metadata sans valeur clinique).
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth, AuthError } from "@/lib/auth"
import { checkApiRateLimit, RATE_LIMITS } from "@/lib/auth/api-rate-limit"
import { resolvePatientIdFromQuery } from "@/lib/auth/query-helpers"
import { requireGdprConsent } from "@/lib/gdpr"
import { patientShareConsent } from "@/lib/consent"
import { analyticsService } from "@/lib/services/analytics.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditAnalyticsAccessDenied } from "@/lib/audit/analytics-helpers"

const querySchema = z.object({
  period: z
    .string()
    .regex(/^[1-9]\d{0,1}d$/)
    .refine((s) => parseInt(s, 10) <= 90, { message: "Period max 90 days" })
    .default("14d"),
})

export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req)

    const rl = await checkApiRateLimit(String(user.id), RATE_LIMITS.analytics)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "rateLimitExceeded" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
      )
    }

    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })

    const ctx = extractRequestContext(req)

    const res = await resolvePatientIdFromQuery(req, user.id, user.role)
    if (res.error) {
      if (res.error === "patientNotFound") {
        await auditAnalyticsAccessDenied({ user, ctx, resourceId: "bgm-daily-pattern", metadata: { reason: res.error } })
      }
      return NextResponse.json({ error: res.error }, { status: res.error === "invalidPatientId" ? 400 : 404 })
    }
    const patientId = res.patientId

    const params = Object.fromEntries(req.nextUrl.searchParams.entries())
    const parsed = querySchema.safeParse(params)
    if (!parsed.success) return NextResponse.json({ error: "validationFailed" }, { status: 400 })

    const consent = await patientShareConsent(patientId)
    if (!consent.ok) return NextResponse.json({ error: consent.error }, { status: consent.status })

    const result = await analyticsService.bgmDailyPatternByMoment(patientId, parsed.data.period, user.id, ctx)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[analytics/bgm-daily-pattern]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
