/**
 * US-2224 — Emergency alerts inbox (list + manual create).
 *
 * GET   → DOCTOR/NURSE/ADMIN — list alerts with filters & pagination.
 *         **RBAC scoping**: non-ADMIN callers are restricted to their
 *         accessible patient portfolio via getAccessiblePatientIds.
 * POST  → NURSE+ — create a manual alert (cooldown applies; rate limited).
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole, AuthError } from "@/lib/auth"
import { canAccessPatient, getAccessiblePatientIds } from "@/lib/access-control"
import { extractRequestContext } from "@/lib/services/audit.service"
import { emergencyService } from "@/lib/services/emergency.service"
import { logger } from "@/lib/logger"

const statusEnum = z.enum(["open", "acknowledged", "resolved", "expired"])
const severityEnum = z.enum(["info", "warning", "critical"])
const alertTypeEnum = z.enum([
  "severe_hypo",
  "hypo",
  "severe_hyper",
  "hyper",
  "ketone_dka",
  "ketone_moderate",
  "manual",
])

function parseEnumList<T extends string>(
  value: string | null,
  schema: z.ZodType<T>,
): T[] | undefined {
  if (!value) return undefined
  const arr = value.split(",").map((v) => v.trim()).filter(Boolean)
  if (arr.length === 0) return undefined
  const parsed = z.array(schema).safeParse(arr)
  if (!parsed.success) return undefined
  return parsed.data
}

export async function GET(req: NextRequest) {
  try {
    const user = requireRole(req, "NURSE")
    const sp = req.nextUrl.searchParams

    // Validate scalar query params via Zod for consistent 400 errors.
    const intSchema = z.coerce.number().int().positive().optional()
    const dateSchema = z.coerce.date().optional()

    const patientIdParsed = intSchema.safeParse(sp.get("patientId") ?? undefined)
    const limitParsed = intSchema.safeParse(sp.get("limit") ?? undefined)
    const cursorParsed = intSchema.safeParse(sp.get("cursor") ?? undefined)
    const fromParsed = dateSchema.safeParse(sp.get("from") ?? undefined)
    const toParsed = dateSchema.safeParse(sp.get("to") ?? undefined)

    if (
      !patientIdParsed.success ||
      !limitParsed.success ||
      !cursorParsed.success ||
      !fromParsed.success ||
      !toParsed.success
    ) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }

    const patientId = patientIdParsed.data
    let scopePatientIds: number[] | null | undefined

    if (patientId !== undefined) {
      // Explicit patient filter — verify access individually.
      const allowed = await canAccessPatient(user.id, user.role, patientId)
      if (!allowed) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 })
      }
      scopePatientIds = undefined // patientId already constrains the query
    } else {
      // No explicit filter — restrict to caller's portfolio.
      scopePatientIds = await getAccessiblePatientIds(user.id, user.role)
    }

    const filter = {
      status: parseEnumList(sp.get("status"), statusEnum),
      severity: parseEnumList(sp.get("severity"), severityEnum),
      alertType: parseEnumList(sp.get("alertType"), alertTypeEnum),
      from: fromParsed.data,
      to: toParsed.data,
      patientId,
      scopePatientIds,
      limit: limitParsed.data,
      cursor: cursorParsed.data,
    }

    const ctx = extractRequestContext(req)
    const result = await emergencyService.list(filter, user.id, ctx)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error("api", "emergency-alerts GET failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

const postSchema = z.object({
  patientId: z.number().int().positive(),
  severity: severityEnum.default("warning"),
  notes: z.string().max(2000).optional(),
})

const POST_USER_ERROR_CODES = new Set([
  "patient_not_found",
  "manual_alert_cooldown",
])

export async function POST(req: NextRequest) {
  try {
    const user = requireRole(req, "NURSE")
    const body = await req.json()
    const parsed = postSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const { patientId, severity, notes } = parsed.data
    const allowed = await canAccessPatient(user.id, user.role, patientId)
    if (!allowed) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    const ctx = extractRequestContext(req)
    try {
      const alert = await emergencyService.createManual(
        { patientId, severity, notes },
        user.id,
        ctx,
      )
      return NextResponse.json(alert, { status: 201 })
    } catch (e) {
      const msg = e instanceof Error ? e.message : "serverError"
      if (msg === "patient_not_found") {
        return NextResponse.json({ error: msg }, { status: 404 })
      }
      if (msg === "manual_alert_cooldown") {
        return NextResponse.json({ error: msg }, { status: 429 })
      }
      if (POST_USER_ERROR_CODES.has(msg)) {
        return NextResponse.json({ error: msg }, { status: 400 })
      }
      throw e
    }
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error("api", "emergency-alerts POST failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
