/**
 * US-2096 — Cohorte par pathologie.
 *
 * Renvoie les KPI agrégés (count, TIR moyen, GMI moyen, actifs 24h) découpés
 * par pathologie (DT1, DT2, GD). Cohortes vides incluses pour stabilité front.
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole, AuthError } from "@/lib/auth"
import { resolveAnalyticsPatientIds } from "@/lib/analytics-scope"
import { checkApiRateLimit, RATE_LIMITS } from "@/lib/auth/api-rate-limit"
import { populationAnalyticsService } from "@/lib/services/population-analytics.service"
import { extractRequestContext } from "@/lib/services/audit.service"

const querySchema = z.object({
  windowDays: z.coerce.number().int().min(1).max(30).default(14),
})

export async function GET(req: NextRequest) {
  try {
    const user = requireRole(req, "NURSE")

    const rl = await checkApiRateLimit(String(user.id), RATE_LIMITS.analytics)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "rateLimitExceeded" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
      )
    }

    const parsed = querySchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams.entries()),
    )
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }

    const patientIds = await resolveAnalyticsPatientIds(user.id, user.role)
    const ctx = extractRequestContext(req)
    const result = await populationAnalyticsService.cohortsByPathology(
      patientIds,
      parsed.data.windowDays,
      user.id,
      ctx,
    )
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[analytics/cohorts]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
