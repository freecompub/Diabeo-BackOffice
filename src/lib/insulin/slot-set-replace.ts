/**
 * @module slot-set-replace
 * @description US-2655 — Handler HTTP **mutualisé** du PUT « remplace le jeu complet » de créneaux
 * insuline (ISF/ICR). Factorise la logique identique des routes `sensitivity-factors` et `carb-ratios`
 * (auth DOCTOR, consentement RGPD, résolution patient anti-IDOR, appel service, mapping erreurs→HTTP).
 */

import { NextResponse, type NextRequest } from "next/server"
import type { z } from "zod"
import { requireRole, AuthError } from "@/lib/auth"
import { resolvePatientId } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { insulinTherapyService } from "@/lib/services/insulin-therapy.service"
import { extractRequestContext } from "@/lib/services/audit.service"

/** Créneau normalisé (valeur = ISF g/L ou ICR g/U), forme attendue par `replaceSlotSet`. */
export type NormalizedSlot = { startHour: number; endHour: number; value: number; mealLabel?: string }

/** Corps normalisé d'un PUT de remplacement de groupe. */
export type ReplaceSetBody = { patientId?: number; slots: NormalizedSlot[] }

/** Codes d'erreur métier du remplacement de groupe → statut HTTP (stables, sans PHI). */
const SLOT_SET_ERROR_STATUS: Record<string, number> = {
  emptySlotSet: 409,
  zeroDurationSlot: 400,
  slotOverlap: 409,
  slotGap: 422,
  valueOutOfBounds: 400,
  settingsNotFound: 404,
  slotsBusy: 409, // mutation concurrente en cours (verrou non bloquant) — réessayer
}

/**
 * PUT mutualisé — remplace atomiquement TOUT le jeu de créneaux (`param`) du patient. DOCTOR only,
 * scopé patient (anti-IDOR). Cohérence re-validée serveur par `replaceSlotSet` (chevauchement 409,
 * trou 422, durée nulle 400, valeur hors bornes 400, jeu vide 409). Propositions pending supersédées.
 *
 * @param schema - Zod validant le corps et **normalisant** chaque créneau vers `NormalizedSlot`
 *   (via `.transform` côté route : `sensitivityFactorGl`/`gramsPerUnit` → `value`).
 * @param logTag - préfixe de log serveur (ex. `"[sensitivity-factors PUT]"`).
 */
export async function handleSlotSetReplace(
  req: NextRequest,
  param: "isf" | "icr",
  schema: z.ZodType<ReplaceSetBody>,
  logTag: string,
): Promise<NextResponse> {
  try {
    const user = requireRole(req, "DOCTOR")
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })

    const parsed = schema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed", details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }
    const patientId = await resolvePatientId(user.id, user.role, parsed.data.patientId)
    if (!patientId) return NextResponse.json({ error: "patientNotFound" }, { status: 404 })

    try {
      const result = await insulinTherapyService.replaceSlotSet(
        param,
        patientId,
        parsed.data.slots,
        user.id,
        extractRequestContext(req),
      )
      return NextResponse.json(result)
    } catch (e) {
      const status = e instanceof Error ? SLOT_SET_ERROR_STATUS[e.message] : undefined
      if (status) return NextResponse.json({ error: (e as Error).message }, { status })
      throw e
    }
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error(logTag, msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
