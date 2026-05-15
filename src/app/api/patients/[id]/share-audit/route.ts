/**
 * Groupe 10 Batch D — US-2239 audit partages temporaires.
 * GET — historique audit events liés aux partages tiers + notifications
 * routing pour un patient. DOCTOR+ only (audit forensique HDS).
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { shareAuditQuery } from "@/lib/services/share-audit.service"
import {
  auditService, extractRequestContext,
} from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

const paramsSchema = z.object({ id: z.coerce.number().int().positive() })

type RouteCtx = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: RouteCtx) {
  const ctx = extractRequestContext(req)
  try {
    const parsed = paramsSchema.safeParse(await params)
    if (!parsed.success) {
      return NextResponse.json({ error: "invalidPatientId" }, { status: 400 })
    }
    const patientId = parsed.data.id
    // DOCTOR-only : forensic audit access (HDS).
    const user = await auditedRequireRole(req, "DOCTOR", ctx, "AUDIT_LOG", String(patientId))
    const allowed = await canAccessPatient(user.id, user.role, patientId)
    if (!allowed) {
      await auditService.accessDenied({
        userId: user.id, resource: "AUDIT_LOG", resourceId: String(patientId),
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        metadata: { patientId, endpoint: "share-audit" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    const items = await shareAuditQuery.forPatient(patientId, user.id, ctx)
    return NextResponse.json({ items })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "patients/[id]/share-audit GET", ctx.requestId)
  }
}
