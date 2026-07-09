import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth, requireRole, AuthError } from "@/lib/auth"
import { resolvePatientId } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { insulinTherapyService, INSULIN_BOUNDS } from "@/lib/services/insulin-therapy.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { handleSlotSetReplace } from "@/lib/insulin/slot-set-replace"

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

const updateIsfSchema = z.object({
  id: z.string().uuid(),
  patientId: z.number().int().positive().optional(),
  sensitivityFactorGl: z.number().min(INSULIN_BOUNDS.ISF_GL_MIN).max(INSULIN_BOUNDS.ISF_GL_MAX),
})

/**
 * PATCH — édition DIRECTE de la valeur d'un créneau ISF (US-2648b). DOCTOR only ;
 * NURSE/patient passent par une proposition. Scopé patient (updateIsf via settings.patientId).
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
      const result = await insulinTherapyService.updateIsf(
        parsed.data.id,
        parsed.data.sensitivityFactorGl,
        user.id,
        patientId,
        extractRequestContext(req),
      )
      return NextResponse.json(result)
    } catch (e) {
      if (e instanceof Error && e.message === "isfSlotNotFound") {
        return NextResponse.json({ error: "isfSlotNotFound" }, { status: 404 })
      }
      if (e instanceof Error && e.message === "slotsBusy") {
        return NextResponse.json({ error: "slotsBusy" }, { status: 409 }) // mutation concurrente — réessayer
      }
      throw e
    }
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[sensitivity-factors PATCH]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

// US-2655 — PUT = remplacement du JEU COMPLET de créneaux ISF (« replace the whole set »).
// Zod normalise chaque créneau vers `{ startHour, endHour, value }` (value = ISF g/L) ; la logique
// HTTP (auth DOCTOR, RGPD, anti-IDOR, mapping erreurs) est mutualisée dans `handleSlotSetReplace`.
const replaceIsfSchema = z.object({
  patientId: z.number().int().positive().optional(),
  slots: z
    .array(
      z
        .object({
          startHour: z.number().int().min(0).max(23),
          endHour: z.number().int().min(0).max(23),
          sensitivityFactorGl: z.number().min(INSULIN_BOUNDS.ISF_GL_MIN).max(INSULIN_BOUNDS.ISF_GL_MAX),
        })
        .transform((s) => ({ startHour: s.startHour, endHour: s.endHour, value: s.sensitivityFactorGl })),
    )
    .min(1),
})

export const PUT = (req: NextRequest) => handleSlotSetReplace(req, "isf", replaceIsfSchema, "[sensitivity-factors PUT]")
