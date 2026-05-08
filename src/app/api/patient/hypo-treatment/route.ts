/**
 * US-2217 — Per-patient hypoglycemia treatment protocol.
 *
 * GET  → patient (own) + pros via patientId query param.
 * PUT  → DOCTOR only.
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth, requireRole, AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { resolvePatientIdFromQuery } from "@/lib/auth/query-helpers"
import { extractRequestContext } from "@/lib/services/audit.service"
import { auditForbiddenInRoute } from "@/lib/audit/route-helpers"
import {
  hypoTreatmentService,
  HYPO_TREATMENT_BOUNDS,
} from "@/lib/services/hypo-treatment.service"
import { logger } from "@/lib/logger"

const USER_ERROR_CODES = new Set([
  "carbs_out_of_bounds",
  "retest_out_of_bounds",
  "sugar_type_other_required",
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
    const data = await hypoTreatmentService.get(res.patientId, user.id, ctx)
    if (!data) {
      return NextResponse.json({ error: "patientNotFound" }, { status: 404 })
    }
    return NextResponse.json(data)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error("api", "patient/hypo-treatment GET failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

const sugarTypeEnum = z.enum([
  "glucose_tabs",
  "juice",
  "candy",
  "honey",
  "sugar_packets",
  "other",
])

const putSchema = z.object({
  patientId: z.number().int().positive(),
  sugarType: sugarTypeEnum.optional(),
  sugarTypeOther: z.string().max(200).nullable().optional(),
  fastCarbsGrams: z
    .number()
    .int()
    .min(HYPO_TREATMENT_BOUNDS.CARBS_MIN)
    .max(HYPO_TREATMENT_BOUNDS.CARBS_MAX)
    .optional(),
  retestMinutes: z
    .number()
    .int()
    .min(HYPO_TREATMENT_BOUNDS.RETEST_MIN)
    .max(HYPO_TREATMENT_BOUNDS.RETEST_MAX)
    .optional(),
  allergies: z.string().max(500).nullable().optional(),
  instructions: z.string().max(1000).nullable().optional(),
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
    const ctx = extractRequestContext(req)
    if (!allowed) {
      await auditForbiddenInRoute({
        user, ctx,
        resource: "HYPO_TREATMENT_PROTOCOL",
        resourceId: String(patientId),
        metadata: { method: "PUT" },
      })
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    try {
      const result = await hypoTreatmentService.upsert(patientId, input, user.id, ctx)
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
    logger.error("api", "patient/hypo-treatment PUT failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
