import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth, requireRole, AuthError } from "@/lib/auth"
import { resolvePatientId } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { insulinTherapyService, INSULIN_BOUNDS } from "@/lib/services/insulin-therapy.service"
import { extractRequestContext } from "@/lib/services/audit.service"

const createIcrSchema = z.object({
  patientId: z.number().int().positive().optional(),
  startHour: z.number().int().min(0).max(23),
  endHour: z.number().int().min(0).max(23),
  gramsPerUnit: z.number().min(INSULIN_BOUNDS.ICR_MIN).max(INSULIN_BOUNDS.ICR_MAX),
  mealLabel: z.string().max(50).optional(),
})

export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })

    const patientIdParam = req.nextUrl.searchParams.get("patientId")
    const patientId = await resolvePatientId(user.id, user.role, patientIdParam ? parseInt(patientIdParam, 10) : undefined)
    if (!patientId) return NextResponse.json({ error: "patientNotFound" }, { status: 404 })

    const ctx = extractRequestContext(req)
    const settings = await insulinTherapyService.getSettings(patientId, user.id, ctx)
    return NextResponse.json(settings?.carbRatios ?? [])
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[carb-ratios GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    // US-2648a — écriture DIRECTE réservée au DOCTOR. ICR pilote calculateBolus ;
    // NURSE/patient passent par une proposition validée (POST /api/adjustment-proposals).
    const user = requireRole(req, "DOCTOR")
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })

    const body = await req.json()
    const parsed = createIcrSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed", details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }

    const { patientId: pidParam, ...icrInput } = parsed.data
    const patientId = await resolvePatientId(user.id, user.role, pidParam)
    if (!patientId) return NextResponse.json({ error: "patientNotFound" }, { status: 404 })

    const settings = await insulinTherapyService.getSettings(patientId, user.id)
    if (!settings) return NextResponse.json({ error: "settingsNotFound" }, { status: 404 })

    const result = await insulinTherapyService.createIcr(settings.id, icrInput, user.id)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[carb-ratios POST]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

// PATCH à corps DISCRIMINÉ : VALEUR (`gramsPerUnit`) ou HEURES (`startHour`/`endHour`, US-2654).
const updateIcrValueSchema = z.object({
  id: z.string().uuid(),
  patientId: z.number().int().positive().optional(),
  gramsPerUnit: z.number().min(INSULIN_BOUNDS.ICR_MIN).max(INSULIN_BOUNDS.ICR_MAX),
})
const updateIcrHoursSchema = z.object({
  id: z.string().uuid(),
  patientId: z.number().int().positive().optional(),
  startHour: z.number().int().min(0).max(23),
  endHour: z.number().int().min(0).max(23),
})
const updateIcrSchema = z.union([updateIcrValueSchema, updateIcrHoursSchema])

/** Codes d'erreur restructuration ICR → HTTP (stables, sans PHI). */
const SLOT_ERROR_STATUS: Record<string, number> = {
  icrSlotNotFound: 404,
  zeroDurationSlot: 400,
  slotOverlapWouldRemain: 409,
}

/** PATCH — édition DIRECTE d'un créneau ICR (US-2648b valeur, US-2654 heures atomiques). DOCTOR only ; scopé patient. */
export async function PATCH(req: NextRequest) {
  try {
    const user = requireRole(req, "DOCTOR")
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })

    const parsed = updateIcrSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed", details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }
    const patientId = await resolvePatientId(user.id, user.role, parsed.data.patientId)
    if (!patientId) return NextResponse.json({ error: "patientNotFound" }, { status: 404 })

    try {
      const ctx = extractRequestContext(req)
      const d = parsed.data
      const result =
        "gramsPerUnit" in d
          ? await insulinTherapyService.updateIcr(d.id, d.gramsPerUnit, user.id, patientId, ctx)
          : await insulinTherapyService.updateIcrHours(d.id, d.startHour, d.endHour, user.id, patientId, ctx)
      return NextResponse.json(result)
    } catch (e) {
      const status = e instanceof Error ? SLOT_ERROR_STATUS[e.message] : undefined
      if (status) return NextResponse.json({ error: (e as Error).message }, { status })
      throw e
    }
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[carb-ratios PATCH]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
