/**
 * @module /api/insulin-therapy/carb-ratios
 * @description Créneaux ICR — **GET** (liste) + **PUT** (remplacement GROUPÉ du jeu entier).
 *
 * US-2657 (grouped-only, ADR #23) : l'édition ICR se fait **exclusivement en bloc** via `PUT`, quel que soit
 * le rôle. Les anciennes écritures **par-créneau** `POST` (createIcr) et `PATCH` (updateIcr) sont **retirées**
 * (elles ré-ouvraient la « dérive de base »), et la méthode service `updateIcr` a été supprimée avec le
 * retrait de l'auto-application.
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth, AuthError } from "@/lib/auth"
import { resolvePatientId } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { insulinTherapyService, INSULIN_BOUNDS } from "@/lib/services/insulin-therapy.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { handleSlotSetReplace } from "@/lib/insulin/slot-set-replace"

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

// US-2655 — PUT = remplacement du JEU COMPLET de créneaux ICR (« replace the whole set »).
// Zod normalise chaque créneau vers `{ startHour, endHour, value, mealLabel? }` (value = ICR g/U) ;
// la logique HTTP est mutualisée dans `handleSlotSetReplace`.
const replaceIcrSchema = z.object({
  patientId: z.number().int().positive().optional(),
  slots: z
    .array(
      z
        .object({
          startHour: z.number().int().min(0).max(23),
          endHour: z.number().int().min(0).max(23),
          gramsPerUnit: z.number().min(INSULIN_BOUNDS.ICR_MIN).max(INSULIN_BOUNDS.ICR_MAX),
          mealLabel: z.string().max(50).optional(),
        })
        .transform((s) => ({ startHour: s.startHour, endHour: s.endHour, value: s.gramsPerUnit, mealLabel: s.mealLabel })),
    )
    .min(1),
})

export const PUT = (req: NextRequest) =>
  handleSlotSetReplace(req, replaceIcrSchema, "[carb-ratios PUT]", (patientId, slots, userId, ctx) =>
    insulinTherapyService.replaceSlotSet("icr", patientId, slots, userId, ctx),
  )
