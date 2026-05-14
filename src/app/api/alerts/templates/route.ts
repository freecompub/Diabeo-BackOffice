/** US-2220 — Alert threshold templates (cabinet library). */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { isOrgMember } from "@/lib/org-access"
import { alertThresholdTemplateService } from "@/lib/services/mirror-v1-config.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

const PROFILE_TYPES = [
  "T1_ADULT_STABLE", "T1_ADOLESCENT", "T2_INSULIN",
  "GESTATIONAL", "PEDIATRIC",
] as const

const createSchema = z.object({
  organizationId: z.number().int().positive(),
  profileType: z.enum(PROFILE_TYPES),
  name: z.string().min(1).max(100),
  glucoseLowMgdl: z.number().min(40).max(250),
  glucoseHighMgdl: z.number().min(100).max(400),
  glucoseVeryLowMgdl: z.number().min(30).max(200),
  glucoseVeryHighMgdl: z.number().min(150).max(500),
  alertOnHypo: z.boolean().optional(),
  cooldownMinutes: z.number().int().min(5).max(360).optional(),
}).superRefine((v, ctx) => {
  // M3 — cross-field ordering at Zod level for fast 400.
  if (!(v.glucoseVeryLowMgdl < v.glucoseLowMgdl
    && v.glucoseLowMgdl < v.glucoseHighMgdl
    && v.glucoseHighMgdl < v.glucoseVeryHighMgdl)) {
    ctx.addIssue({ code: "custom", message: "threshold ordering", path: ["glucoseLowMgdl"] })
  }
})

const listSchema = z.object({
  organizationId: z.coerce.number().int().positive(),
})

async function denyIfNotMember(
  req: NextRequest, user: { id: number; role: import("@prisma/client").Role },
  orgId: number, endpoint: string,
) {
  const ctx = extractRequestContext(req)
  if (await isOrgMember(user.id, user.role, orgId)) return null
  await auditService.accessDenied({
    userId: user.id, resource: "ALERT_THRESHOLD_TEMPLATE",
    resourceId: String(orgId),
    ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
    metadata: { organizationId: orgId, endpoint },
  })
  return NextResponse.json({ error: "forbidden" }, { status: 403 })
}

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const parsed = listSchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams.entries()),
    )
    if (!parsed.success) return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    const user = await auditedRequireRole(req, "NURSE", ctx, "ALERT_THRESHOLD_TEMPLATE", String(parsed.data.organizationId))
    // C2 — block cross-tenant library reads.
    const denied = await denyIfNotMember(req, user, parsed.data.organizationId, "list")
    if (denied) return denied
    const items = await alertThresholdTemplateService.list(parsed.data.organizationId)
    return NextResponse.json({ items })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "alerts/templates GET", ctx.requestId)
  }
}

export async function POST(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const body = await req.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const user = await auditedRequireRole(req, "DOCTOR", ctx, "ALERT_THRESHOLD_TEMPLATE", String(parsed.data.organizationId))
    const denied = await denyIfNotMember(req, user, parsed.data.organizationId, "create")
    if (denied) return denied
    const out = await alertThresholdTemplateService.create(parsed.data, user.id, ctx)
    return NextResponse.json(out, { status: 201 })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "alerts/templates POST", ctx.requestId)
  }
}
