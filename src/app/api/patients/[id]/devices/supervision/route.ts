/**
 * @route GET /api/patients/[id]/devices/supervision
 * @description US-2243 — Vue supervision dispositifs d'un patient.
 *   RBAC : VIEWER own / NURSE+ cabinet via canAccessPatient.
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"
import { requireGdprConsent } from "@/lib/gdpr"
import {
  deviceSupervisionService,
  DeviceSupervisionAccessError,
} from "@/lib/services/device-supervision.service"

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
      const items = await deviceSupervisionService.listByPatient(
        parsedParams.data.id, user.id, user.role, ctx,
      )
      return NextResponse.json({ items })
    } catch (e) {
      if (e instanceof DeviceSupervisionAccessError) {
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
    return mapErrorToResponse(e, "patients/:id/devices/supervision GET", ctx.requestId)
  }
}
