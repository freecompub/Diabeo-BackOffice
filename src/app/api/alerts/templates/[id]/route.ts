/** US-2220 — Delete an alert threshold template (DOCTOR + org member). */

import { NextResponse, type NextRequest } from "next/server"
import { AuthError } from "@/lib/auth"
import { prisma } from "@/lib/db/client"
import { isOrgMember } from "@/lib/org-access"
import { alertThresholdTemplateService } from "@/lib/services/mirror-v1-config.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

type RouteParams = { params: Promise<{ id: string }> }

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const ctx = extractRequestContext(req)
  try {
    const { id } = await params
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: "invalidId" }, { status: 400 })
    const user = await auditedRequireRole(req, "DOCTOR", ctx, "ALERT_THRESHOLD_TEMPLATE", id)

    // C2 — verify template belongs to an org the caller is a member of.
    const template = await prisma.alertThresholdTemplate.findUnique({
      where: { id: parseInt(id, 10) },
      select: { id: true, organizationId: true },
    })
    if (!template) return NextResponse.json({ error: "notFound" }, { status: 404 })
    if (!(await isOrgMember(user.id, user.role, template.organizationId))) {
      await auditService.accessDenied({
        userId: user.id, resource: "ALERT_THRESHOLD_TEMPLATE", resourceId: id,
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        metadata: { organizationId: template.organizationId, endpoint: "delete" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    const out = await alertThresholdTemplateService.deleteById(parseInt(id, 10), user.id, ctx)
    return NextResponse.json(out)
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "alerts/templates DELETE", ctx.requestId)
  }
}
