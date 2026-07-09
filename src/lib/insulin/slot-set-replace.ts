/**
 * @module slot-set-replace
 * @description US-2655 / US-2657 — Handler HTTP **mutualisé** du PUT « remplace le jeu complet » de créneaux
 * insuline. Cœur UNIQUE des 3 routes de remplacement groupé (`sensitivity-factors`, `carb-ratios`,
 * `basal-config/pump-slots`) : auth DOCTOR, consentement RGPD, résolution patient anti-IDOR, mapping
 * erreurs→HTTP. Le paramètre `apply` branche le service de persistance propre à chaque paramètre
 * (`replaceSlotSet` ISF/ICR à créneaux horaires entiers ; `replacePumpSlotSet` basal à temps `HH:MM`).
 *
 * ⚠️ Anti-dérive (revue #710) : les 3 routes DOIVENT partager ces garanties. Toute route de remplacement
 * groupé passe par ici — un test de parité (`api-slot-set-replace-parity`) verrouille l'invariant.
 */

import { NextResponse, type NextRequest } from "next/server"
import type { z } from "zod"
import { requireRole, AuthError } from "@/lib/auth"
import { resolvePatientId } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { extractRequestContext, type AuditContext } from "@/lib/services/audit.service"
import { SLOT_SET_ERROR_STATUS } from "@/lib/insulin/slot-set-errors"

/** Créneau ISF/ICR normalisé (valeur = ISF g/L ou ICR g/U), forme attendue par `replaceSlotSet`. */
export type NormalizedSlot = { startHour: number; endHour: number; value: number; mealLabel?: string }

/** Corps normalisé d'un PUT de remplacement de groupe (générique sur la forme du créneau). */
export type ReplaceSetBody<TSlot = NormalizedSlot> = { patientId?: number; slots: TSlot[] }

/**
 * Applique le jeu complet en base (branché par la route). Reçoit le patient **déjà résolu** (anti-IDOR) —
 * ne doit jamais re-dériver le périmètre depuis le body.
 */
export type ApplySlotSet<TSlot> = (
  patientId: number,
  slots: TSlot[],
  userId: number,
  ctx: AuditContext,
) => Promise<unknown>

/**
 * PUT mutualisé — remplace atomiquement TOUT le jeu de créneaux du patient. **DOCTOR only**, scopé patient
 * (anti-IDOR), consentement RGPD requis. Cohérence re-validée serveur par le service `apply` (chevauchement
 * 409, trou 422, durée nulle 400, valeur/débit hors bornes 400, jeu vide 409, verrou occupé 409). Toute erreur
 * métier connue → 4xx via `SLOT_SET_ERROR_STATUS` ; inattendue → 500 générique (sans fuite).
 *
 * @param schema - Zod validant/normalisant le corps `{ patientId?, slots }`.
 * @param logTag - préfixe de log serveur (ex. `"[sensitivity-factors PUT]"`).
 * @param apply - service de persistance (`replaceSlotSet` ISF/ICR, `replacePumpSlotSet` basal).
 */
export async function handleSlotSetReplace<TSlot>(
  req: NextRequest,
  schema: z.ZodType<ReplaceSetBody<TSlot>>,
  logTag: string,
  apply: ApplySlotSet<TSlot>,
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
      const result = await apply(patientId, parsed.data.slots, user.id, extractRequestContext(req))
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
