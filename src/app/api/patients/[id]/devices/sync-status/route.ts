/**
 * @route GET /api/patients/[id]/devices/sync-status
 * @description US-2244 — Statut sync temps-réel patient.
 *   Retourne `{ patientId, status, lastSyncAt, minutesSinceLastSync }`.
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"
import { requireGdprConsent } from "@/lib/gdpr"
import {
  deviceSyncStatusService,
  SyncStatusAccessError,
} from "@/lib/services/device-sync-status.service"

const paramsSchema = z.object({ id: z.coerce.number().int().positive() })

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = extractRequestContext(req)
  try {
    const raw = await params
    const parsedParams = paramsSchema.safeParse(raw)
    if (!parsedParams.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }
    const user = await auditedRequireRole(
      req, "VIEWER", ctx, "DEVICE", String(parsedParams.data.id),
    )
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
    }

    try {
      const status = await deviceSyncStatusService.getStatus(
        parsedParams.data.id, user.id, user.role, ctx,
      )
      return NextResponse.json(status)
    } catch (e) {
      if (e instanceof SyncStatusAccessError) {
        try {
          await auditService.accessDenied({
            userId: user.id,
            resource: "DEVICE",
            resourceId: String(parsedParams.data.id),
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            requestId: ctx.requestId,
            metadata: { patientId: parsedParams.data.id, reason: e.message },
          })
        } catch { /* swallow */ }
        return NextResponse.json({ error: "forbidden" }, { status: 403 })
      }
      throw e
    }
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "patients/:id/devices/sync-status GET", ctx.requestId)
  }
}
