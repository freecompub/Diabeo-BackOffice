/**
 * @module /api/insulin-therapy/basal-config
 * @description Basal configuration routes — GET (read), PUT (upsert).
 * US-402 — Basal configuration (pump & injections).
 * Supports pump, single_injection, and split_injection delivery types.
 * All operations require auth + GDPR consent + audit logging.
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { BasalConfigType } from "@prisma/client"
import { requireAuth, requireRole, AuthError } from "@/lib/auth"
import { resolvePatientId } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { insulinTherapyService } from "@/lib/services/insulin-therapy.service"
import { extractRequestContext } from "@/lib/services/audit.service"

const upsertSchema = z.object({
  patientId: z.number().int().positive().optional(),
  configType: z.nativeEnum(BasalConfigType),
  totalDailyDose: z.number().min(0).max(200).optional(),
  morningDose: z.number().min(0).max(100).optional(),
  eveningDose: z.number().min(0).max(100).optional(),
  dailyDose: z.number().min(0).max(200).optional(),
})

/**
 * GET /api/insulin-therapy/basal-config?patientId=
 * Returns basal configuration with pump slots for a patient.
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

    const config = await insulinTherapyService.getBasalConfig(settings.id)
    if (!config) {
      return NextResponse.json({ error: "basalConfigNotFound" }, { status: 404 })
    }
    return NextResponse.json(config)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[basal-config GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

/**
 * PUT /api/insulin-therapy/basal-config
 * Create or update basal configuration for a patient.
 */
export async function PUT(req: NextRequest) {
  try {
    const user = requireRole(req, "NURSE")
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
    }

    const body = await req.json()
    const parsed = upsertSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const { patientId: pidParam, ...configInput } = parsed.data
    const patientId = await resolvePatientId(user.id, user.role, pidParam)
    if (!patientId) {
      return NextResponse.json({ error: "patientNotFound" }, { status: 404 })
    }

    const ctx = extractRequestContext(req)
    const settings = await insulinTherapyService.getSettings(patientId, user.id, ctx)
    if (!settings) {
      return NextResponse.json({ error: "settingsNotFound" }, { status: 404 })
    }

    const result = await insulinTherapyService.upsertBasalConfig(
      settings.id,
      configInput,
      user.id,
      ctx,
    )

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[basal-config PUT]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
