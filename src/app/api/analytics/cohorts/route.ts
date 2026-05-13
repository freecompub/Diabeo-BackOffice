/** US-2096 — Cohorte par pathologie. */

import { NextResponse, type NextRequest } from "next/server"
import { requireRole, getAuthUser, AuthError } from "@/lib/auth"
import { resolveAnalyticsScope } from "@/lib/analytics-scope"
import { checkApiRateLimit, RATE_LIMITS } from "@/lib/auth/api-rate-limit"
import {
  populationAnalyticsService,
  PopulationTooLargeError,
  MAX_WINDOW_DAYS,
} from "@/lib/services/population-analytics.service"
import { windowDaysSchema } from "@/lib/validators/analytics"
import { extractRequestContext } from "@/lib/services/audit.service"
import {
  auditAnalyticsAccessDenied,
  auditAnalyticsFailure,
} from "@/lib/audit/analytics-helpers"

const querySchema = windowDaysSchema(MAX_WINDOW_DAYS)

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  let user
  try {
    user = requireRole(req, "NURSE")
  } catch (e) {
    if (e instanceof AuthError) {
      const u = getAuthUser(req)
      if (u && e.status === 403) {
        await auditAnalyticsAccessDenied({ user: u, ctx, resourceId: "cohorts" })
      }
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    throw e
  }

  try {
    const rl = await checkApiRateLimit(String(user.id), RATE_LIMITS.analytics)
    if (!rl.allowed) {
      await auditAnalyticsFailure({
        user, ctx, resourceId: "cohorts", reason: "rateLimitExceeded",
        action: "RATE_LIMITED",
      })
      return NextResponse.json(
        { error: "rateLimitExceeded" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
      )
    }

    const parsed = querySchema.safeParse(req.nextUrl.searchParams.get("windowDays") ?? undefined)
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }

    const scope = await resolveAnalyticsScope(user.id, user.role)
    const result = await populationAnalyticsService.cohortsByPathology(
      scope, parsed.data, user.id, ctx,
    )
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof PopulationTooLargeError) {
      await auditAnalyticsFailure({
        user, ctx, resourceId: "cohorts", reason: "populationTooLarge",
        action: "RATE_LIMITED",
        metadata: { observed: error.observed, cap: error.cap },
      })
      return NextResponse.json({ error: "populationTooLarge" }, { status: 413 })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[analytics/cohorts]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
