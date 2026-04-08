/**
 * @module /api/insulin-therapy/basal-config/pump-slots
 * @description Pump basal slot routes — GET (list), POST (create), DELETE (remove).
 * US-402 — Pump basal slots define hourly basal rates for insulin pump delivery.
 * Rate validated within clinical bounds (BASAL_MIN: 0.05, BASAL_MAX: 10.0 U/h).
 * All operations require auth + GDPR consent + audit logging.
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth, requireRole, AuthError } from "@/lib/auth"
import { resolvePatientId } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { insulinTherapyService, INSULIN_BOUNDS } from "@/lib/services/insulin-therapy.service"
import { extractRequestContext } from "@/lib/services/audit.service"

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/

const createSlotSchema = z.object({
  patientId: z.number().int().positive().optional(),
  startTime: z.string().regex(timeRegex, "Format HH:MM required"),
  endTime: z.string().regex(timeRegex, "Format HH:MM required"),
  rate: z.number().min(INSULIN_BOUNDS.BASAL_MIN).max(INSULIN_BOUNDS.BASAL_MAX),
}).refine((d) => d.startTime !== d.endTime, {
  message: "startTime and endTime must be different — a zero-duration slot is invalid",
  path: ["endTime"],
})

const deleteSlotSchema = z.object({
  id: z.string().uuid(),
  patientId: z.coerce.number().int().positive().optional(),
})

/**
 * GET /api/insulin-therapy/basal-config/pump-slots?patientId=
 * Returns all pump basal slots for a patient's basal configuration.
 */
export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
    }

    const patientIdParam = req.nextUrl.searchParams.get("patientId")
    const patientId = await resolvePatientId(
      user.id, user.role,
      patientIdParam ? parseInt(patientIdParam, 10) : undefined,
    )
    if (!patientId) {
      return NextResponse.json({ error: "patientNotFound" }, { status: 404 })
    }

    const ctx = extractRequestContext(req)
    const settings = await insulinTherapyService.getSettings(patientId, user.id, ctx)
    if (!settings) {
      return NextResponse.json({ error: "settingsNotFound" }, { status: 404 })
    }

    // M3 fix: getSettings already includes basalConfiguration.pumpSlots — no second query
    return NextResponse.json(settings.basalConfiguration?.pumpSlots ?? [])
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[pump-slots GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

/**
 * POST /api/insulin-therapy/basal-config/pump-slots
 * Create a new pump basal slot. Requires NURSE+ role.
 */
export async function POST(req: NextRequest) {
  try {
    const user = requireRole(req, "NURSE")
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
    }

    const body = await req.json()
    const parsed = createSlotSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const { patientId: pidParam, ...slotInput } = parsed.data
    const patientId = await resolvePatientId(user.id, user.role, pidParam)
    if (!patientId) {
      return NextResponse.json({ error: "patientNotFound" }, { status: 404 })
    }

    const ctx = extractRequestContext(req)
    const settings = await insulinTherapyService.getSettings(patientId, user.id, ctx)
    if (!settings) {
      return NextResponse.json({ error: "settingsNotFound" }, { status: 404 })
    }

    // M3 fix: reuse basalConfiguration from getSettings (already included)
    const config = settings.basalConfiguration
    if (!config) {
      return NextResponse.json({ error: "basalConfigNotFound" }, { status: 404 })
    }

    const slot = await insulinTherapyService.createPumpSlot(
      config.id, slotInput, user.id, ctx,
    )

    return NextResponse.json(slot, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[pump-slots POST]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

/**
 * DELETE /api/insulin-therapy/basal-config/pump-slots?id=
 * Delete a pump basal slot by UUID. Requires NURSE+ role.
 */
export async function DELETE(req: NextRequest) {
  try {
    const user = requireRole(req, "NURSE")
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
    }

    const params = Object.fromEntries(req.nextUrl.searchParams)
    const parsed = deleteSlotSchema.safeParse(params)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    // B1 fix: verify slot belongs to caller's patient before deleting
    const patientId = await resolvePatientId(user.id, user.role, parsed.data.patientId)
    if (!patientId) {
      return NextResponse.json({ error: "patientNotFound" }, { status: 404 })
    }

    const ctx = extractRequestContext(req)
    const settings = await insulinTherapyService.getSettings(patientId, user.id, ctx)
    if (!settings?.basalConfiguration) {
      return NextResponse.json({ error: "basalConfigNotFound" }, { status: 404 })
    }

    const slotBelongs = settings.basalConfiguration.pumpSlots.some(
      (s) => s.id === parsed.data.id,
    )
    if (!slotBelongs) {
      return NextResponse.json({ error: "slotNotFound" }, { status: 404 })
    }

    const result = await insulinTherapyService.deletePumpSlot(
      parsed.data.id, user.id, ctx,
    )

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[pump-slots DELETE]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
