/**
 * @route GET /api/patients/[id]/devices/history
 * @description US-2093 — Historique des dispositifs d'un patient (incl. révoqués).
 *
 * Tri chronologique inverse (revoked en premier, puis date d'ajout DESC).
 *
 * Auth : VIEWER own / NURSE+ cabinet member.
 * Audit : `DEVICE/READ` kind `device.history` + pivot `patientId`.
 *
 * Query params :
 *   - `limit` (1-100, default 100)
 *   - `includeRevoked` (default true)
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError, requireAuth } from "@/lib/auth"
import { prisma } from "@/lib/db/client"
import { extractRequestContext } from "@/lib/services/audit.service"
import { mapErrorToResponse } from "@/lib/team-route-helpers"
import { requireGdprConsent } from "@/lib/gdpr"
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
    // CR H4 review — consent du data subject (patient owner), pas du caller.
    const patient = await prisma.patient.findFirst({
      where: { id: parsedParams.data.id, deletedAt: null },
      select: { userId: true },
    })
    if (!patient) {
      return NextResponse.json({ error: "notFound" }, { status: 404 })
    }
    const hasConsent = await requireGdprConsent(patient.userId)
    if (!hasConsent) {
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
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
