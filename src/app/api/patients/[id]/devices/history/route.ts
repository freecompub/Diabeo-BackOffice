/**
 * @route GET /api/patients/[id]/devices/history
 * @description US-2093 — Historique des dispositifs d'un patient (incl. révoqués).
 *
 * Tri chronologique strict sur `createdAt DESC` (HSA M1 + Prisma F-1
 * round 2 — cursor-safe keyset, voir docstring listHistory).
 *
 * Auth : VIEWER own / NURSE+ cabinet member.
 * RBAC : helper unifié `resolvePatientForConsent` (anti-énumération round 2
 * HIGH-2 — 403 forbidden uniforme pour les non-autorisés).
 * Audit : `DEVICE/READ` kind `device.history` + pivot `patientId`.
 *
 * Query params :
 *   - `limit` (1-100, default 100)
 *   - `includeRevoked` (default true)
 *   - `cursor` (id du dernier device de la page précédente — keyset)
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError, requireAuth } from "@/lib/auth"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { mapErrorToResponse } from "@/lib/team-route-helpers"
import { resolvePatientForConsent } from "@/lib/access-control"
import {
  deviceLifecycleService,
  DEVICE_LIFECYCLE_BOUNDS,
  DeviceLifecycleAccessError,
} from "@/lib/services/device-lifecycle.service"

const paramsSchema = z.object({
  id: z.coerce.number().int().positive(),
})

const querySchema = z.object({
  limit: z.coerce.number().int().positive()
    .max(DEVICE_LIFECYCLE_BOUNDS.MAX_HISTORY_PAGE).optional(),
  includeRevoked: z.coerce.boolean().optional(),
  // HSA L1 review — cursor pagination (keyset).
  cursor: z.coerce.number().int().positive().optional(),
})

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
    const parsedQuery = querySchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams.entries()),
    )
    if (!parsedQuery.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsedQuery.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const user = requireAuth(req)

    // HIGH-2 round 2 review — helper unifié RBAC + consent + 403 uniforme.
    const resolved = await resolvePatientForConsent(
      user.id, user.role, parsedParams.data.id,
      {
        onAccessDenied: async () => {
          await auditService.accessDenied({
            userId: user.id,
            resource: "DEVICE",
            resourceId: String(parsedParams.data.id),
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            requestId: ctx.requestId,
            metadata: { kind: "device.history.accessDenied" },
          }).catch(() => undefined)
        },
      },
    )
    if (!resolved) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    try {
      const result = await deviceLifecycleService.listHistory(
        parsedParams.data.id, user.id, user.role, ctx,
        {
          limit: parsedQuery.data.limit,
          includeRevoked: parsedQuery.data.includeRevoked,
          cursorId: parsedQuery.data.cursor,
        },
      )
      return NextResponse.json(
        { items: result.items, nextCursor: result.nextCursor },
        { headers: { "Cache-Control": "no-store, private" } },
      )
    } catch (e) {
      if (e instanceof DeviceLifecycleAccessError) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 })
      }
      throw e
    }
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    return mapErrorToResponse(e, "patients/:id/devices/history GET", ctx.requestId)
  }
}
