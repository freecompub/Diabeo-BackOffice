/** US-2095 — Indicateurs qualité (cabinet). */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole, AuthError } from "@/lib/auth"
import { resolveAnalyticsScope } from "@/lib/analytics-scope"
import { checkApiRateLimit, RATE_LIMITS } from "@/lib/auth/api-rate-limit"
import {
  populationAnalyticsService,
  MAX_WINDOW_DAYS,
} from "@/lib/services/population-analytics.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditAnalyticsFailure } from "@/lib/audit/analytics-helpers"

const querySchema = z.object({
  windowDays: z.coerce.number().int().min(1).max(MAX_WINDOW_DAYS).default(14),
})

export async function GET(req: NextRequest) {
  let user: Awaited<ReturnType<typeof requireRole>> | null = null
  const ctx = extractRequestContext(req)
  try {
    user = requireRole(req, "NURSE")

    const rl = await checkApiRateLimit(String(user.id), RATE_LIMITS.analytics)
    if (!rl.allowed) {
      await auditAnalyticsFailure({
        user, ctx, resourceId: "quality", reason: "rateLimitExceeded",
        action: "RATE_LIMITED",
      })
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

    const scope = await resolveAnalyticsScope(user.id, user.role)
    const result = await populationAnalyticsService.qualityIndicators(
      scope, parsed.data.windowDays, user.id, ctx,
    )
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    if (msg.startsWith("populationTooLarge") && user) {
      await auditAnalyticsFailure({
        user, ctx, resourceId: "quality", reason: "populationTooLarge",
      })
      return NextResponse.json({ error: "populationTooLarge" }, { status: 413 })
    }
    console.error("[analytics/quality-indicators]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
