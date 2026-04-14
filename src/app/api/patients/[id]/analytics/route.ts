import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole, AuthError } from "@/lib/auth"
import { checkApiRateLimit, RATE_LIMITS } from "@/lib/auth/api-rate-limit"
import { canAccessPatient } from "@/lib/access-control"
import { prisma } from "@/lib/db/client"
import { analyticsService } from "@/lib/services/analytics.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"

type RouteParams = { params: Promise<{ id: string }> }

const querySchema = z.object({
  period: z.string().regex(/^[1-9]\d{0,1}d$/).refine((s) => parseInt(s, 10) <= 90, { message: "Period max 90 days" }).default("14d"),
})

/** GET /api/patients/:id/analytics — pro access to patient glycemic profile */
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const user = requireRole(req, "NURSE")

    const rl = await checkApiRateLimit(String(user.id), RATE_LIMITS.analytics)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "rateLimitExceeded" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
      )
    }

    const { id } = await params
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: "invalidPatientId" }, { status: 400 })
    const patientId = parseInt(id, 10)

    // Validate query params BEFORE access check (no timing oracle)
    const queryParams = Object.fromEntries(req.nextUrl.searchParams.entries())
    const parsed = querySchema.safeParse(queryParams)
    if (!parsed.success) return NextResponse.json({ error: "validationFailed", details: parsed.error.flatten().fieldErrors }, { status: 400 })

    const ctx = extractRequestContext(req)
    const allowed = await canAccessPatient(user.id, user.role, patientId)
    if (!allowed) {
      await auditService.log({
        userId: user.id, action: "UNAUTHORIZED", resource: "CGM_ENTRY",
        resourceId: String(patientId), ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    // Check shareWithProviders
    const patient = await prisma.patient.findFirst({ where: { id: patientId, deletedAt: null }, select: { userId: true } })
    if (!patient) return NextResponse.json({ error: "patientNotFound" }, { status: 404 })

    const privacy = await prisma.userPrivacySettings.findUnique({ where: { userId: patient.userId } })
    if (privacy && !privacy.shareWithProviders) {
      return NextResponse.json({ error: "sharingDisabled" }, { status: 403 })
    }

    const result = await analyticsService.glycemicProfile(patientId, parsed.data.period, user.id, ctx)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[patients/:id/analytics GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
