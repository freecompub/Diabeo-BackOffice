/**
 * US-2039 — Comparaison de deux périodes (avant / après ajustement).
 *
 * Compare deux fenêtres contiguës de même durée (N jours) sur les métriques
 * clés : TIR, GMI, glucose moyen, CV, capture rate. Renvoie également le
 * delta entre les deux périodes (recent vs previous).
 *
 * Cas d'usage type : vérifier l'effet d'un ajustement de basale ou d'ISF
 * sur deux semaines comparables.
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth, AuthError } from "@/lib/auth"
import { checkApiRateLimit, RATE_LIMITS } from "@/lib/auth/api-rate-limit"
import { resolvePatientIdFromQuery } from "@/lib/auth/query-helpers"
import { requireGdprConsent } from "@/lib/gdpr"
import { analyticsService } from "@/lib/services/analytics.service"
import { extractRequestContext } from "@/lib/services/audit.service"

const querySchema = z.object({
  period: z
    .string()
    .regex(/^[1-9]\d{0,1}d$/)
    .refine((s) => parseInt(s, 10) <= 45, { message: "Period max 45 days per window" })
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
    if (!hasConsent) {
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
    }

    const res = await resolvePatientIdFromQuery(req, user.id, user.role)
    if (res.error) {
      return NextResponse.json(
        { error: res.error },
        { status: res.error === "invalidPatientId" ? 400 : 404 },
      )
    }
    const patientId = res.patientId

    const parsed = querySchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams.entries()),
    )
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }

    const ctx = extractRequestContext(req)
    const result = await analyticsService.compare(
      patientId,
      parsed.data.period,
      user.id,
      ctx,
    )
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[analytics/compare]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
