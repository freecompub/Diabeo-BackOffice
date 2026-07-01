/**
 * US-2638 (slice B) — GET /api/analytics/bgm-stats
 *
 * Stats glycémie **capillaire** (patient sans capteur) pilotées par la période :
 * moyenne des relevés, **% de relevés en cible** (≠ TIR-temps), fréquence
 * (relevés/jour) et nuage de points modal-day. Sert les deux contrats
 * (`?patientId=` page / cTok drawer). Gardes alignées sur les autres routes
 * analytics per-patient. Lecture `READ GLYCEMIA_ENTRY` scopée + auditée dans le
 * service (`kind="bgmStats"`, metadata sans valeur clinique).
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
        await auditAnalyticsAccessDenied({ user, ctx, resourceId: "bgm-stats", metadata: { reason: res.error } })
      }
      return NextResponse.json({ error: res.error }, { status: res.error === "invalidPatientId" ? 400 : 404 })
    }
    const patientId = res.patientId

    const params = Object.fromEntries(req.nextUrl.searchParams.entries())
    const parsed = querySchema.safeParse(params)
    if (!parsed.success) return NextResponse.json({ error: "validationFailed" }, { status: 400 })

    const consent = await patientShareConsent(patientId)
    if (!consent.ok) return NextResponse.json({ error: consent.error }, { status: consent.status })

    const result = await analyticsService.bgmStats(patientId, parsed.data.period, user.id, ctx)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[analytics/bgm-stats]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
