/**
 * US-2224 — Emergency alerts inbox (list + manual create).
 *
 * GET   → all authenticated roles. RBAC scoping:
 *         - ADMIN: unrestricted
 *         - DOCTOR/NURSE: portfolio (PatientService membership)
 *         - VIEWER (patient): own alerts only (RGPD Art. 15 right of access)
 * POST  → NURSE+ — create a manual alert (cooldown applies). Severity
 *         "critical" requires DOCTOR/ADMIN role + non-empty notes.
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth, requireRole, AuthError } from "@/lib/auth"
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

type EnumListResult<T> = { ok: true; value: T[] | undefined } | { ok: false }

function parseEnumList<T extends string>(
  value: string | null,
  schema: z.ZodType<T>,
): EnumListResult<T> {
  if (!value) return { ok: true, value: undefined }
  const arr = value.split(",").map((v) => v.trim()).filter(Boolean)
  if (arr.length === 0) return { ok: true, value: undefined }
  const parsed = z.array(schema).safeParse(arr)
  if (!parsed.success) return { ok: false }
  return { ok: true, value: parsed.data }
}

export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const sp = req.nextUrl.searchParams

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

    const statusList = parseEnumList(sp.get("status"), statusEnum)
    const severityList = parseEnumList(sp.get("severity"), severityEnum)
    const alertTypeList = parseEnumList(sp.get("alertType"), alertTypeEnum)
    if (!statusList.ok || !severityList.ok || !alertTypeList.ok) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }

    const patientId = patientIdParsed.data
    let scopePatientIds: number[] | null | undefined

    if (patientId !== undefined) {
      const allowed = await canAccessPatient(user.id, user.role, patientId)
      if (!allowed) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 })
      }
      scopePatientIds = undefined
    } else {
      // No explicit filter — RBAC scope applies to every role except ADMIN.
      scopePatientIds = await getAccessiblePatientIds(user.id, user.role)
    }

    const filter = {
      status: statusList.value,
      severity: severityList.value,
      alertType: alertTypeList.value,
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

const POST_USER_ERROR_CODES = new Map<string, number>([
  ["patient_not_found", 404],
  ["manual_alert_cooldown", 429],
  ["critical_manual_requires_doctor", 403],
  ["critical_manual_requires_notes", 400],
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
        { patientId, severity, notes, callerRole: user.role },
        user.id,
        ctx,
      )
      return NextResponse.json(alert, { status: 201 })
    } catch (e) {
      const msg = e instanceof Error ? e.message : "serverError"
      const status = POST_USER_ERROR_CODES.get(msg)
      if (status) {
        return NextResponse.json({ error: msg }, { status })
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
