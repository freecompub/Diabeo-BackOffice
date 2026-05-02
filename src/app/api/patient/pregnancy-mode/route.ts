/**
 * US-2232 — Pregnancy mode toggle.
 *
 * Enabling tightens CGM thresholds (GD defaults). Disabling restores standard
 * defaults. Only DOCTOR can flip the switch (clinical decision).
 *
 * Disabling while a `PatientPregnancy.active` record exists is rejected with
 * 409 unless `forceOverride: true` is sent (audit-tagged for forensics).
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole, AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { extractRequestContext } from "@/lib/services/audit.service"
import { pregnancyModeService } from "@/lib/services/pregnancy-mode.service"
import { logger } from "@/lib/logger"

const putSchema = z
  .object({
    patientId: z.number().int().positive(),
    enabled: z.boolean(),
    forceOverride: z.boolean().optional(),
    forceOverrideReason: z.string().min(20).max(500).optional(),
  })
  .refine(
    (d) => !d.forceOverride || (d.forceOverrideReason?.trim().length ?? 0) >= 20,
    { message: "forceOverrideReason required (≥ 20 chars) when forceOverride=true" },
  )

const USER_ERROR_CODES = new Map<string, number>([
  ["patient_not_found", 404],
  ["active_pregnancy_blocks_toggle_off", 409],
  ["force_override_reason_required", 400],
])

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

    const { patientId, enabled, forceOverride, forceOverrideReason } = parsed.data
    const allowed = await canAccessPatient(user.id, user.role, patientId)
    if (!allowed) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    const ctx = extractRequestContext(req)
    try {
      const result = await pregnancyModeService.setMode(
        patientId,
        enabled,
        user.id,
        ctx,
        { forceOverride, forceOverrideReason },
      )
      return NextResponse.json(result)
    } catch (e) {
      const msg = e instanceof Error ? e.message : "validationFailed"
      const status = USER_ERROR_CODES.get(msg)
      if (status) {
        return NextResponse.json({ error: msg }, { status })
      }
      throw e
    }
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error("api", "patient/pregnancy-mode PUT failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
