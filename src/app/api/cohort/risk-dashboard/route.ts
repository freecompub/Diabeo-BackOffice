/** US-2229 — Cohort risk dashboard (DOCTOR+). */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { riskScoreService } from "@/lib/services/mirror-v1-analytics.service"
import { extractRequestContext } from "@/lib/services/audit.service"
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
    const items = await riskScoreService.dashboard(parsed.data.organizationId, user.id, ctx)
    return NextResponse.json({ items })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "cohort/risk-dashboard GET", ctx.requestId)
  }
}
