import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth, AuthError } from "@/lib/auth"
import { checkApiRateLimit, RATE_LIMITS } from "@/lib/auth/api-rate-limit"
import { resolvePatientId } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { analyticsService } from "@/lib/services/analytics.service"
import { extractRequestContext } from "@/lib/services/audit.service"

const querySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
}).refine((d) => d.from < d.to, { message: "from must be before to" })

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

    const pidParam = new URL(req.url).searchParams.get("patientId")
    const patientId = await resolvePatientId(user.id, user.role, pidParam ? parseInt(pidParam, 10) : undefined)
    if (!patientId) return NextResponse.json({ error: "patientNotFound" }, { status: 404 })

    const params = Object.fromEntries(req.nextUrl.searchParams.entries())
    const parsed = querySchema.safeParse(params)
    if (!parsed.success) return NextResponse.json({ error: "validationFailed" }, { status: 400 })

    const ctx = extractRequestContext(req)
    const result = await analyticsService.insulinSummary(
      patientId, parsed.data.from, parsed.data.to, user.id, ctx,
    )
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[analytics/insulin]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
