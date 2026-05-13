/**
 * US-2095 — Indicateurs qualité (cabinet).
 *
 * Distributions TIR (4 bandes ADA) et GMI (4 bandes HbA1c) sur la fenêtre.
 * Scope NURSE+ pour les vues qualité du dashboard.
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
    const result = await populationAnalyticsService.qualityIndicators(
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
    console.error("[analytics/quality-indicators]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
