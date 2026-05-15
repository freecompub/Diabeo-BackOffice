/**
 * @route GET /api/devices/supervision/cohort
 * @description US-2243 — Vue cohorte dispositifs accessibles au caller.
 *   Filtres : ?batteryLow=true&sensorExpiringSoon=true&category=cgm
 *   RBAC : NURSE+ (VIEWER n'a pas accès cohort).
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"
import { requireGdprConsent } from "@/lib/gdpr"
import { deviceSupervisionService } from "@/lib/services/device-supervision.service"

const querySchema = z.object({
  batteryLow: z.enum(["true", "false"]).optional().transform((v) => v === "true"),
  sensorExpiringSoon: z.enum(["true", "false"]).optional().transform((v) => v === "true"),
  category: z.enum([
    "glucometer", "cgm", "insulinPump", "insulinPen", "healthApp",
  ]).optional(),
  limit: z.coerce.number().int().positive().max(500).default(50),
  cursor: z.coerce.number().int().positive().optional(),
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

    const items = await deviceSupervisionService.listCohort(
      parsedQuery.data, user.id, user.role, ctx,
    )
    return NextResponse.json({ items })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    return mapErrorToResponse(e, "devices/supervision/cohort GET", ctx.requestId)
  }
}
