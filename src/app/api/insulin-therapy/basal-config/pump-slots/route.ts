/**
 * @module /api/insulin-therapy/basal-config/pump-slots
 * @description Créneaux basaux pompe — **GET** (liste) + **PUT** (remplacement GROUPÉ du jeu entier).
 *
 * US-2657 (grouped-only, ADR #23) : l'édition basale se fait **exclusivement en bloc** via `PUT`
 * (`replacePumpSlotSet`), quel que soit le rôle. Les anciennes écritures **par-créneau**
 * (`POST`/`PATCH`/`DELETE`) sont **retirées** — elles ré-ouvraient la fenêtre de « dérive de base »
 * (un édit unitaire ne supersédait pas une proposition d'ensemble pending) et divergeaient du modèle groupé.
 * Les méthodes service par-créneau (`updatePumpSlot`) ont été supprimées avec le retrait de l'auto-application.
 *
 * Débit validé dans les bornes cliniques (BASAL_MIN 0,05 / BASAL_MAX 5,0 U/h) et **délivrable** (multiple de
 * l'incrément pompe 0,05 U/h). Couverture 24 h no-overlap / no-gap re-validée serveur (`assertValidPumpSlotSet`).
 * Auth + consentement RGPD + audit sur toutes les opérations.
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth, AuthError } from "@/lib/auth"
import { resolvePatientId } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { insulinTherapyService, INSULIN_BOUNDS } from "@/lib/services/insulin-therapy.service"
import { isDeliverableBasalRate } from "@/lib/clinical-bounds"
import { handleSlotSetReplace } from "@/lib/insulin/slot-set-replace"
import { extractRequestContext } from "@/lib/services/audit.service"

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * GET /api/insulin-therapy/basal-config/pump-slots?patientId=
 * Retourne tous les créneaux basaux du patient (lecture — ouverte VIEWER own / pro scopé).
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

    // getSettings inclut déjà basalConfiguration.pumpSlots — pas de seconde requête.
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

const replaceBasalSchema = z.object({
  patientId: z.number().int().positive().optional(),
  slots: z
    .array(
      z.object({
        startTime: z.string().regex(timeRegex, "Format HH:MM required"),
        endTime: z.string().regex(timeRegex, "Format HH:MM required"),
        // Débit PROGRAMMABLE (multiple de l'incrément pompe) — re-validé serveur par `assertValidPumpSlotSet`.
        rate: z
          .number()
          .min(INSULIN_BOUNDS.BASAL_MIN)
          .max(INSULIN_BOUNDS.BASAL_MAX)
          .refine(isDeliverableBasalRate, { message: "rate must be a multiple of the pump increment (0.05 U/h)" }),
      }),
    )
    .min(1)
    .max(48), // borne anti-abus (48 créneaux de 30 min couvrent 24 h)
})

/**
 * PUT /api/insulin-therapy/basal-config/pump-slots — **remplace tout le jeu** de créneaux basaux. DOCTOR only,
 * scopé patient (anti-IDOR). Mutualise l'enveloppe HTTP (auth/consentement/anti-IDOR/mapping erreurs) avec
 * les routes ISF/ICR via `handleSlotSetReplace` (revue #710 : cœur unique anti-dérive) ; seul le service de
 * persistance diffère (`replacePumpSlotSet` → `assertValidPumpSlotSet` : chevauchement 409, trou 422, durée
 * nulle 400, débit hors bornes/non délivrable 400, patient non pompe 409). Propositions basales `pending`
 * supersédées ; verrou occupé → 409.
 */
export const PUT = (req: NextRequest) =>
  handleSlotSetReplace(req, replaceBasalSchema, "[pump-slots PUT]", (patientId, slots, userId, ctx) =>
    insulinTherapyService.replacePumpSlotSet(patientId, slots, userId, ctx),
  )
