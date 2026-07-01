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
  period: z.string().regex(/^[1-9]\d{0,1}d$/).refine((s) => parseInt(s, 10) <= 90, { message: "Period max 90 days" }).default("14d"),
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
      // Détection d'énumération (US-2265) : tracer la tentative hors périmètre,
      // aligné sur heatmap. Route désormais chemin chaud du re-fetch client.
      if (res.error === "patientNotFound") {
        await auditAnalyticsAccessDenied({
          user, ctx, resourceId: "glycemic-profile", metadata: { reason: res.error },
        })
      }
      return NextResponse.json({ error: res.error }, { status: res.error === "invalidPatientId" ? 400 : 404 })
    }
    const patientId = res.patientId

    // Validation d'input AVANT la lecture consentement (évite un round-trip DB
    // sur une période malformée).
    const params = Object.fromEntries(req.nextUrl.searchParams.entries())
    const parsed = querySchema.safeParse(params)
    if (!parsed.success) return NextResponse.json({ error: "validationFailed" }, { status: 400 })

    // Opt-out du SUJET (fail-closed) — aligné sur heatmap/compare/agp et le
    // garde-fou de l'épopée fiche patient (US-2630) : pas d'exposition d'un
    // patient en opt-out de partage, même à un PS RBAC-autorisé.
    const consent = await patientShareConsent(patientId)
    if (!consent.ok) return NextResponse.json({ error: consent.error }, { status: consent.status })

    const result = await analyticsService.glycemicProfile(patientId, parsed.data.period, user.id, ctx)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[analytics/glycemic-profile]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
