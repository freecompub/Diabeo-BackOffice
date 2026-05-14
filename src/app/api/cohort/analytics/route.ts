/** US-2228 — Cohort analytics snapshot (DOCTOR+ in own org, ADMIN global). */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { isOrgMember } from "@/lib/org-access"
import { cohortAnalyticsService } from "@/lib/services/mirror-v1-analytics.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

const querySchema = z.object({
  organizationId: z.coerce.number().int().positive(),
})

const recomputeSchema = z.object({
  organizationId: z.number().int().positive(),
  snapshotDate: z.coerce.date().optional(),
})

async function denyIfNotMember(
  req: NextRequest, user: { id: number; role: import("@prisma/client").Role },
  orgId: number, endpoint: string,
) {
  const ctx = extractRequestContext(req)
  if (await isOrgMember(user.id, user.role, orgId)) return null
  await auditService.accessDenied({
    userId: user.id, resource: "COHORT_ANALYTICS",
    resourceId: String(orgId),
    ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
    metadata: { organizationId: orgId, endpoint },
  })
  return NextResponse.json({ error: "forbidden" }, { status: 403 })
}

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const parsed = querySchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams.entries()),
    )
    if (!parsed.success) return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    const user = await auditedRequireRole(req, "DOCTOR", ctx, "COHORT_ANALYTICS", String(parsed.data.organizationId))
    const denied = await denyIfNotMember(req, user, parsed.data.organizationId, "snapshot.get")
    if (denied) return denied
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
    // M3-NEW (re-review) — POST is ADMIN-only (super-admin). isOrgMember()
    //   would bypass for ADMIN anyway, so the check is dead code. ADMIN is
    //   intentionally trusted to recompute any org's analytics.
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
