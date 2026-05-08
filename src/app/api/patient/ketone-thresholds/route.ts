/**
 * US-2216 — Per-patient ketone thresholds.
 *
 * GET  → patient (own) + pros via patientId query param.
 * PUT  → DOCTOR only (clinical configuration).
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth, requireRole, AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { resolvePatientIdFromQuery } from "@/lib/auth/query-helpers"
import { extractRequestContext } from "@/lib/services/audit.service"
import {
  ketoneThresholdService,
  KETONE_BOUNDS,
} from "@/lib/services/ketone-threshold.service"
import { logger } from "@/lib/logger"

const USER_ERROR_CODES = new Set([
  "ketone_threshold_below_min",
  "ketone_threshold_above_max",
  "light_must_be_less_than_moderate",
  "moderate_must_be_lte_dka",
])

export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const res = await resolvePatientIdFromQuery(req, user.id, user.role)
    if (res.error) {
      return NextResponse.json(
        { error: res.error },
        { status: res.error === "invalidPatientId" ? 400 : 404 },
      )
    }

    const ctx = extractRequestContext(req)
    const data = await ketoneThresholdService.get(res.patientId, user.id, ctx)
    if (!data) {
      return NextResponse.json({ error: "patientNotFound" }, { status: 404 })
    }
    return NextResponse.json(data)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error("api", "patient/ketone-thresholds GET failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

const putSchema = z.object({
  patientId: z.number().int().positive(),
  lightThreshold: z.number().min(KETONE_BOUNDS.MIN).max(KETONE_BOUNDS.MAX).optional(),
  moderateThreshold: z.number().min(KETONE_BOUNDS.MIN).max(KETONE_BOUNDS.MAX).optional(),
  dkaThreshold: z.number().min(KETONE_BOUNDS.MIN).max(KETONE_BOUNDS.MAX).optional(),
  alertOnModerate: z.boolean().optional(),
  alertOnDka: z.boolean().optional(),
})

export async function PUT(req: NextRequest) {
  try {
    const user = requireRole(req, "DOCTOR")
    const body = await req.json()
    const parsed = putSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const { patientId, ...input } = parsed.data
    const allowed = await canAccessPatient(user.id, user.role, patientId)
    if (!allowed) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    const ctx = extractRequestContext(req)
    try {
      const result = await ketoneThresholdService.upsert(patientId, input, user.id, ctx)
      return NextResponse.json(result)
    } catch (e) {
      const msg = e instanceof Error ? e.message : "validationFailed"
      if (USER_ERROR_CODES.has(msg)) {
        return NextResponse.json({ error: msg }, { status: 400 })
      }
      throw e
    }
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error("api", "patient/ketone-thresholds PUT failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
