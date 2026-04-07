import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth, AuthError } from "@/lib/auth"
import { resolvePatientId } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { analyticsService } from "@/lib/services/analytics.service"
import { extractRequestContext } from "@/lib/services/audit.service"

const querySchema = z.object({
  period: z.string().regex(/^[1-9]\d{0,1}d$/).refine((s) => parseInt(s, 10) <= 90, { message: "Period max 90 days" }).default("7d"),
})

export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })

    const pidParam = req instanceof Request ? new URL(req.url).searchParams.get("patientId") : null
    const patientId = await resolvePatientId(user.id, user.role, pidParam ? parseInt(pidParam, 10) : undefined)
    if (!patientId) return NextResponse.json({ error: "patientNotFound" }, { status: 404 })

    const params = Object.fromEntries(req.nextUrl.searchParams.entries())
    const parsed = querySchema.safeParse(params)
    if (!parsed.success) return NextResponse.json({ error: "validationFailed" }, { status: 400 })

    const ctx = extractRequestContext(req)
    const result = await analyticsService.timeInRange(patientId, parsed.data.period, user.id, ctx)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[analytics/time-in-range]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
