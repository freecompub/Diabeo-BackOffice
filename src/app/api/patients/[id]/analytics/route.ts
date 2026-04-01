import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole, AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { analyticsService } from "@/lib/services/analytics.service"
import { extractRequestContext } from "@/lib/services/audit.service"

type RouteParams = { params: Promise<{ id: string }> }

const querySchema = z.object({
  period: z.string().regex(/^[1-9]\d{0,1}d$/).refine((s) => parseInt(s, 10) <= 90, { message: "Period max 90 days" }).default("14d"),
})

/** GET /api/patients/:id/analytics — pro access to patient glycemic profile */
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const user = requireRole(req, "NURSE")
    const { id } = await params
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: "invalidPatientId" }, { status: 400 })
    const patientId = parseInt(id, 10)

    const ctx = extractRequestContext(req)
    const allowed = await canAccessPatient(user.id, user.role, patientId)
    if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 })

    const queryParams = Object.fromEntries(req.nextUrl.searchParams.entries())
    const parsed = querySchema.safeParse(queryParams)
    if (!parsed.success) return NextResponse.json({ error: "validationFailed" }, { status: 400 })

    const result = await analyticsService.glycemicProfile(patientId, parsed.data.period, user.id, ctx)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[patients/:id/analytics GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
