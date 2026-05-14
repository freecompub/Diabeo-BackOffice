/** US-2221 — ConfigVersion history listing (DOCTOR+ for own patients, ADMIN global). */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { ConfigVersionType } from "@prisma/client"
import { AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { configVersionHistoryService } from "@/lib/services/mirror-v1-config.service"
import {
  auditService, extractRequestContext,
} from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

const listSchema = z.object({
  patientId: z.coerce.number().int().positive(),
  configType: z.enum(ConfigVersionType),
})

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const parsed = listSchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams.entries()),
    )
    if (!parsed.success) return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    const user = await auditedRequireRole(req, "NURSE", ctx, "CONFIG_VERSION", String(parsed.data.patientId))
    const allowed = await canAccessPatient(user.id, user.role, parsed.data.patientId)
    if (!allowed) {
      await auditService.accessDenied({
        userId: user.id, resource: "CONFIG_VERSION", resourceId: String(parsed.data.patientId),
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        metadata: { patientId: parsed.data.patientId, endpoint: "history.list" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    const items = await configVersionHistoryService.listHistory(
      parsed.data.patientId, parsed.data.configType, user.id, ctx,
    )
    return NextResponse.json({ items })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "admin/config-history GET", ctx.requestId)
  }
}
