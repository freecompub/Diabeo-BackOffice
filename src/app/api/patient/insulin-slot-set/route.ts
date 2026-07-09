/**
 * PUT /api/patient/insulin-slot-set — **SOUMISSION SELF-SERVICE PATIENT** d'un jeu de créneaux ISF/ICR
 * (US-2657 slice C3c). Le patient soumet sa **disposition complète** (mono-paramètre) ; l'orchestrateur
 * gouverné `applyExpertGroupGoverned` décide, tout-ou-rien :
 *  - **auto-application** (patient EXPERT, dans l'enveloppe C1–C8) ;
 *  - **proposition médecin** groupée (hors enveloppe / restructuration / cap groupe / non-EXPERT) ;
 *  - **rejet** (frontière MDR : patient non insuliné) ; ou **no-op** (aucune valeur modifiée).
 *
 * **Own-id STRICT (anti-IDOR / anti-énumération)** : patient résolu EXCLUSIVEMENT depuis `user.id` via
 * `getOwnPatientId` — **aucun** `?patientId`, **aucun** token. Un pro (sans dossier patient) → 404 neutre
 * (les pros éditent via `/patients/[id]`, chemin DOCTOR direct immédiat). Consentement RGPD requis.
 * La décision est **auditée par l'orchestrateur** (AUTO_APPLIED_SETTING / AUTO_APPLY_FALLBACK /
 * AUTO_APPLY_REJECTED). Valeurs ISF en **g/L**, ICR en **g/U** (bornes cliniques re-validées serveur).
 *
 * Réponse : l'`outcome` gouverné (200) — `{ outcome: "applied" | "noop" | "proposal" | "rejected", … }`.
 * Rejet dur à la saisie (bornes/couverture invalides) ou verrou occupé → statut HTTP 4xx.
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth, AuthError } from "@/lib/auth"
import { getOwnPatientId } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { autoApplyService } from "@/lib/services/auto-apply.service"
import { SLOT_SET_ERROR_STATUS } from "@/lib/insulin/slot-set-replace"
import { extractRequestContext } from "@/lib/services/audit.service"

const bodySchema = z.object({
  parameterType: z.enum(["insulinSensitivityFactor", "insulinToCarbRatio"]),
  slots: z
    .array(
      z.object({
        startHour: z.number().int().min(0).max(23),
        endHour: z.number().int().min(0).max(23),
        // Bornes cliniques (ISF/ICR) re-validées serveur par `assertValidSlotSet` (→ valueOutOfBounds/400).
        value: z.number().finite().positive(),
        mealLabel: z.string().max(120).optional(),
      }),
    )
    .min(1),
})

export async function PUT(req: NextRequest) {
  try {
    const user = requireAuth(req)

    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })

    // Own-id strict : jamais depuis l'URL/token. Pas de dossier patient (pro) → 404 neutre.
    const patientId = await getOwnPatientId(user.id)
    if (!patientId) return NextResponse.json({ error: "patientNotFound" }, { status: 404 })

    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed", details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }

    try {
      const outcome = await autoApplyService.applyExpertGroupGoverned(
        { patientId, parameterType: parsed.data.parameterType, proposedSlots: parsed.data.slots },
        user.id, // acteur = le patient (pour l'audit / la provenance de proposition)
        new Date(),
        extractRequestContext(req),
      )
      return NextResponse.json(outcome)
    } catch (e) {
      // Rejet dur à la saisie (emptySlotSet / zeroDurationSlot / slotOverlap / slotGap / valueOutOfBounds /
      // settingsNotFound) + slotsBusy → statut HTTP stable, sans PHI.
      const status = e instanceof Error ? SLOT_SET_ERROR_STATUS[e.message] : undefined
      if (status) return NextResponse.json({ error: (e as Error).message }, { status })
      if (e instanceof Error && e.message === "patientNotFound") {
        return NextResponse.json({ error: "patientNotFound" }, { status: 404 })
      }
      throw e
    }
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[patient/insulin-slot-set PUT]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
