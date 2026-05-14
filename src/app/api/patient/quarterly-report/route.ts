/** US-2227 — Per-patient quarterly emergency report. */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { resolvePatientIdFromQuery } from "@/lib/auth/query-helpers"
import { requireGdprConsent } from "@/lib/gdpr"
import { patientMonitoringService } from "@/lib/services/mirror-v1-analytics.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

const querySchema = z.object({
  quarter: z.string().regex(/^[0-9]{4}-Q[1-4]$/),
})

async function gateAndResolve(req: NextRequest, minRole: import("@prisma/client").Role) {
  const ctx = extractRequestContext(req)
  const user = await auditedRequireRole(req, minRole, ctx, "PATIENT_MONITORING_METRICS", "0")
  const res = await resolvePatientIdFromQuery(req, user.id, user.role)
  if (res.error) return { error: NextResponse.json({ error: res.error }, { status: res.error === "invalidPatientId" ? 400 : 404 }) }
  const allowed = await canAccessPatient(user.id, user.role, res.patientId)
  if (!allowed) {
    await auditService.accessDenied({
      userId: user.id, resource: "PATIENT_MONITORING_METRICS", resourceId: String(res.patientId),
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
      metadata: { patientId: res.patientId, endpoint: "quarterly-report" },
    })
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) }
  }
  const hasConsent = await requireGdprConsent(user.id)
  if (!hasConsent) return { error: NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 }) }
  return { user, ctx, patientId: res.patientId }
}

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const parsed = querySchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams.entries()),
    )
    if (!parsed.success) return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    const gate = await gateAndResolve(req, "NURSE")
    if ("error" in gate) return gate.error
    const out = await patientMonitoringService.getOrCompute(
      gate.patientId, parsed.data.quarter, gate.user.id, gate.ctx,
    )
    return NextResponse.json(out)
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "patient/quarterly-report GET", ctx.requestId)
  }
}

export async function POST(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const parsed = querySchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams.entries()),
    )
    if (!parsed.success) return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    // H5-NEW (re-review) — gate at DOCTOR directly so a NURSE attempt produces
    // an `accessDenied` audit row (via auditedRequireRole) instead of slipping
    // past the NURSE gate then being silently rejected.
    const gate = await gateAndResolve(req, "DOCTOR")
    if ("error" in gate) return gate.error
    const out = await patientMonitoringService.recompute(
      gate.patientId, parsed.data.quarter, gate.user.id, gate.ctx,
    )
    return NextResponse.json(out)
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "patient/quarterly-report POST", ctx.requestId)
  }
}
