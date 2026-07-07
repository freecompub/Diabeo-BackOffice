import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth, requireRole, AuthError } from "@/lib/auth"
import { resolvePatientId } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { insulinTherapyService, INSULIN_BOUNDS } from "@/lib/services/insulin-therapy.service"
import { extractRequestContext } from "@/lib/services/audit.service"

const createIsfSchema = z.object({
  patientId: z.number().int().positive().optional(),
  startHour: z.number().int().min(0).max(23),
  endHour: z.number().int().min(0).max(23),
  sensitivityFactorGl: z.number().min(INSULIN_BOUNDS.ISF_GL_MIN).max(INSULIN_BOUNDS.ISF_GL_MAX),
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
    return NextResponse.json(settings?.sensitivityFactors ?? [])
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[sensitivity-factors GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    // US-2648a — écriture DIRECTE réservée au DOCTOR. ISF pilote calculateBolus ;
    // NURSE/patient passent par une proposition validée (POST /api/adjustment-proposals).
    const user = requireRole(req, "DOCTOR")
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })

    const body = await req.json()
    const parsed = createIsfSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed", details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }

    const { patientId: pidParam, ...isfInput } = parsed.data
    const patientId = await resolvePatientId(user.id, user.role, pidParam)
    if (!patientId) return NextResponse.json({ error: "patientNotFound" }, { status: 404 })

    const settings = await insulinTherapyService.getSettings(patientId, user.id)
    if (!settings) return NextResponse.json({ error: "settingsNotFound" }, { status: 404 })

    const result = await insulinTherapyService.createIsf(settings.id, isfInput, user.id)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[sensitivity-factors POST]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

// PATCH à corps DISCRIMINÉ : édition de la VALEUR (`sensitivityFactorGl`) ou des HEURES
// (`startHour`/`endHour`, US-2654 — déplacement atomique de créneau). L'une XOR l'autre.
const updateIsfValueSchema = z.object({
  id: z.string().uuid(),
  patientId: z.number().int().positive().optional(),
  sensitivityFactorGl: z.number().min(INSULIN_BOUNDS.ISF_GL_MIN).max(INSULIN_BOUNDS.ISF_GL_MAX),
})
const updateIsfHoursSchema = z.object({
  id: z.string().uuid(),
  patientId: z.number().int().positive().optional(),
  startHour: z.number().int().min(0).max(23),
  endHour: z.number().int().min(0).max(23),
})
const updateIsfSchema = z.union([updateIsfValueSchema, updateIsfHoursSchema])

/** Codes d'erreur métier de la restructuration → statut HTTP (stables, sans PHI). */
const SLOT_ERROR_STATUS: Record<string, number> = {
  isfSlotNotFound: 404,
  zeroDurationSlot: 400,
  slotOverlapWouldRemain: 409,
}

/**
 * PATCH — édition DIRECTE d'un créneau ISF (US-2648b valeur, US-2654 heures). DOCTOR only ;
 * NURSE/patient passent par une proposition (valeur uniquement). Scopé patient (anti-IDOR).
 * Déplacer les heures est atomique : **chevauchement rejeté** (409) ; **trou de couverture = avertissement**
 * non bloquant (`coverageWarning: "coverageGap"` dans la réponse) — le gate read-time `coherent` protège.
 */
export async function PATCH(req: NextRequest) {
  try {
    const user = requireRole(req, "DOCTOR")
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })

    const parsed = updateIsfSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed", details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }
    const patientId = await resolvePatientId(user.id, user.role, parsed.data.patientId)
    if (!patientId) return NextResponse.json({ error: "patientNotFound" }, { status: 404 })

    try {
      const ctx = extractRequestContext(req)
      const d = parsed.data
      const result =
        "sensitivityFactorGl" in d
          ? await insulinTherapyService.updateIsf(d.id, d.sensitivityFactorGl, user.id, patientId, ctx)
          : await insulinTherapyService.updateIsfHours(d.id, d.startHour, d.endHour, user.id, patientId, ctx)
      return NextResponse.json(result)
    } catch (e) {
      const status = e instanceof Error ? SLOT_ERROR_STATUS[e.message] : undefined
      if (status) return NextResponse.json({ error: (e as Error).message }, { status })
      throw e
    }
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[sensitivity-factors PATCH]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
