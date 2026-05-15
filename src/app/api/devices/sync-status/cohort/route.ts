/**
 * @route GET /api/devices/sync-status/cohort
 * @description US-2244 — Cohort sync status. NURSE+ uniquement.
 *   Query : `?statuses=critical,late&limit=100`
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"
import { requireGdprConsent } from "@/lib/gdpr"
import { deviceSyncStatusService } from "@/lib/services/device-sync-status.service"

const SYNC_STATUSES = ["ok", "late", "critical", "never_synced"] as const

const querySchema = z.object({
  statuses: z.string().optional().transform((s) =>
    s
      ? s.split(",").filter((v) => SYNC_STATUSES.includes(v as typeof SYNC_STATUSES[number])) as typeof SYNC_STATUSES[number][]
      : undefined,
  ),
  limit: z.coerce.number().int().positive().max(500).default(100),
})

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const parsedQuery = querySchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams.entries()),
    )
    if (!parsedQuery.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsedQuery.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const user = await auditedRequireRole(req, "NURSE", ctx, "DEVICE", "cohort")
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
    }

    const items = await deviceSyncStatusService.cohortStatus(
      parsedQuery.data, user.id, user.role, ctx,
    )
    return NextResponse.json({ items })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "devices/sync-status/cohort GET", ctx.requestId)
  }
}
