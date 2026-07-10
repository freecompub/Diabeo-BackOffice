/**
 * @module /api/insulin-therapy/sensitivity-factors
 * @description Créneaux ISF — **GET** (liste) + **PUT** (remplacement GROUPÉ du jeu entier).
 *
 * US-2657 (grouped-only, ADR #23) : l'édition ISF se fait **exclusivement en bloc** via `PUT`, quel que soit
 * le rôle. Les anciennes écritures **par-créneau** `POST` (createIsf) et `PATCH` (updateIsf) sont **retirées**
 * (elles ré-ouvraient la « dérive de base » — un édit unitaire ne supersédait pas une `SlotSetProposal`
 * pending), et les méthodes service par-créneau ont été supprimées avec le retrait de l'auto-application.
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
    return NextResponse.json(settings?.sensitivityFactors ?? [])
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[sensitivity-factors GET]", msg)
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

export const PUT = (req: NextRequest) =>
  handleSlotSetReplace(req, replaceIsfSchema, "[sensitivity-factors PUT]", (patientId, slots, userId, ctx) =>
    insulinTherapyService.replaceSlotSet("isf", patientId, slots, userId, ctx),
  )
