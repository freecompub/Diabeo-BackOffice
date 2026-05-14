/** US-2229 — Cohort risk dashboard (DOCTOR+ in own org). */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { isOrgMember } from "@/lib/org-access"
import { riskScoreService } from "@/lib/services/mirror-v1-analytics.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

const querySchema = z.object({
  organizationId: z.coerce.number().int().positive(),
})

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const parsed = querySchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams.entries()),
    )
    if (!parsed.success) return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    const user = await auditedRequireRole(req, "DOCTOR", ctx, "PATIENT_RISK_SCORE", String(parsed.data.organizationId))
    // C3 — verify caller is a member of the target organization.
    if (!(await isOrgMember(user.id, user.role, parsed.data.organizationId))) {
      await auditService.accessDenied({
        userId: user.id, resource: "PATIENT_RISK_SCORE", resourceId: String(parsed.data.organizationId),
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        metadata: { organizationId: parsed.data.organizationId, endpoint: "dashboard" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    const items = await riskScoreService.dashboard(parsed.data.organizationId, user.id, ctx)
    return NextResponse.json({ items })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "cohort/risk-dashboard GET", ctx.requestId)
  }
}
