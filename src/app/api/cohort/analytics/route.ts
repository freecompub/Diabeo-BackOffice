/** US-2228 — Cohort analytics snapshot (ADMIN/DOCTOR scope). */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { cohortAnalyticsService } from "@/lib/services/mirror-v1-analytics.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

const querySchema = z.object({
  organizationId: z.coerce.number().int().positive(),
})

const recomputeSchema = z.object({
  organizationId: z.number().int().positive(),
  snapshotDate: z.coerce.date().optional(),
})

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const parsed = querySchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams.entries()),
    )
    if (!parsed.success) return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    const user = await auditedRequireRole(req, "DOCTOR", ctx, "COHORT_ANALYTICS", String(parsed.data.organizationId))
    const out = await cohortAnalyticsService.getLatest(parsed.data.organizationId, user.id, ctx)
    if (!out) return NextResponse.json({ error: "notFound" }, { status: 404 })
    return NextResponse.json(out)
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "cohort/analytics GET", ctx.requestId)
  }
}

export async function POST(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const body = await req.json()
    const parsed = recomputeSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const user = await auditedRequireRole(req, "ADMIN", ctx, "COHORT_ANALYTICS", String(parsed.data.organizationId))
    const out = await cohortAnalyticsService.recompute(
      parsed.data.organizationId,
      parsed.data.snapshotDate ?? new Date(),
      user.id, ctx,
    )
    return NextResponse.json(out)
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "cohort/analytics POST", ctx.requestId)
  }
}
