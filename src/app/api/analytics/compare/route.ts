/** US-2039 — Comparaison de deux périodes (avant / après ajustement). */

import { NextResponse, type NextRequest } from "next/server"
import { requireAuth, getAuthUser, AuthError } from "@/lib/auth"
import { checkApiRateLimit, RATE_LIMITS } from "@/lib/auth/api-rate-limit"
import { resolvePatientIdFromQuery } from "@/lib/auth/query-helpers"
import { requireGdprConsent } from "@/lib/gdpr"
import { patientShareConsent } from "@/lib/consent"
import { analyticsService } from "@/lib/services/analytics.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import {
  auditAnalyticsAccessDenied,
  auditAnalyticsFailure,
} from "@/lib/audit/analytics-helpers"
import { periodSchema } from "@/lib/validators/analytics"

const querySchema = periodSchema(45)

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  let user
  try {
    user = requireAuth(req)
  } catch (e) {
    if (e instanceof AuthError) {
      const u = getAuthUser(req)
      if (u && e.status === 403) {
        await auditAnalyticsAccessDenied({ user: u, ctx, resourceId: "compare" })
      }
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    throw e
  }

  try {
    const rl = await checkApiRateLimit(String(user.id), RATE_LIMITS.analytics)
    if (!rl.allowed) {
      await auditAnalyticsFailure({
        user, ctx, resourceId: "compare", reason: "rateLimitExceeded",
        action: "RATE_LIMITED",
      })
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
      if (res.error === "patientNotFound") {
        await auditAnalyticsAccessDenied({
          user, ctx, resourceId: "compare", metadata: { reason: res.error },
        })
      }
      return NextResponse.json(
        { error: res.error },
        { status: res.error === "invalidPatientId" ? 400 : 404 },
      )
    }
    const patientId = res.patientId

    const consent = await patientShareConsent(patientId)
    if (!consent.ok) {
      return NextResponse.json({ error: consent.error }, { status: consent.status })
    }

    const parsed = querySchema.safeParse(req.nextUrl.searchParams.get("period") ?? undefined)
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }

    const result = await analyticsService.compare(patientId, parsed.data, user.id, ctx)
    return NextResponse.json(result)
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[analytics/compare]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
