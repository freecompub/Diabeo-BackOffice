/**
 * PUT /api/patient/insulin-slot-set — **SOUMISSION SELF-SERVICE PATIENT** d'un jeu de créneaux ISF/ICR
 * (US-2657 slice C3c). Le patient soumet sa **disposition complète** (mono-paramètre) ; l'orchestrateur
 * gouverné `applyExpertGroupGoverned` décide, tout-ou-rien :
 *  - **auto-application** (patient EXPERT, dans l'enveloppe C1–C8) ;
 *  - **proposition médecin** groupée (hors enveloppe / restructuration / cap groupe / non-EXPERT) ;
 *  - **rejet** (frontière MDR : patient non insuliné) ; ou **no-op** (aucune valeur modifiée).
 *
 * **Own-id STRICT (anti-IDOR / anti-énumération)** : patient résolu EXCLUSIVEMENT depuis `user.id` via
 * `getOwnPatientId` — **aucun** `?patientId`, **aucun** token. Frontière d'autorisation = `getOwnPatientId`
 * seul (pas de garde de rôle). **Invariant dont dépend l'anti-IDOR** : `Patient.userId @unique` → un
 * `user.id` mappe AU PLUS un dossier (le sien) ; un pro sans dossier → 404 neutre. Si cette cardinalité
 * change un jour, ré-introduire un garde de rôle explicite. Consentement RGPD requis ; rate-limit anti-abus.
 * La décision est **auditée par l'orchestrateur** (AUTO_APPLIED_SETTING / AUTO_APPLY_FALLBACK /
 * AUTO_APPLY_REJECTED) ; la route trace en plus les issues non couvertes (no-op, rejet dur à la saisie)
 * via `INSULIN_SLOT_SUBMISSION`. Valeurs ISF en **g/L**, ICR en **g/U** (bornes re-validées serveur).
 *
 * Réponse : l'`outcome` gouverné (200) — `{ outcome: "applied" | "noop" | "proposal" | "rejected", … }`.
 * Rejet dur à la saisie (bornes/couverture) / doublon / verrou occupé → statut HTTP 4xx.
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth, AuthError } from "@/lib/auth"
import { checkApiRateLimit, RATE_LIMITS } from "@/lib/auth/api-rate-limit"
import { getOwnPatientId } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { autoApplyService } from "@/lib/services/auto-apply.service"
import { SLOT_SET_ERROR_STATUS } from "@/lib/insulin/slot-set-errors"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"

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
    .min(1)
    .max(24), // borne anti-abus : 24 créneaux couvrent 24 h
})

export async function PUT(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const ctx = extractRequestContext(req)

    // Rate-limit (ANSSI, anti-abus) : écriture déclenchant une décision automatisée de dosage. Fail-open
    // (dispo d'abord ; le vrai garde-fou de dosage est l'enveloppe C1–C8 + anti-cliquet C7). Saturation auditée.
    const rl = await checkApiRateLimit(String(user.id), RATE_LIMITS.insulinSubmission)
    if (!rl.allowed) {
      await auditService
        .rateLimited({
          userId: user.id,
          resource: "PATIENT",
          resourceId: "insulin-slot-set",
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          requestId: ctx.requestId,
          metadata: { surface: "api", kind: "insulinSlotSetSubmission" },
        })
        .catch(() => {})
      return NextResponse.json({ error: "rateLimitExceeded" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } })
    }

    // Own-id strict AVANT le consent (ordre canonique : établir le périmètre avant de statuer sur le consent).
    // Pas de dossier patient (pro) → 404 neutre.
    const patientId = await getOwnPatientId(user.id)
    if (!patientId) return NextResponse.json({ error: "patientNotFound" }, { status: 404 })

    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })

    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed", details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }
    const { parameterType, slots } = parsed.data

    try {
      const outcome = await autoApplyService.applyExpertGroupGoverned(
        { patientId, parameterType, proposedSlots: slots },
        user.id, // acteur = le patient (pour l'audit / la provenance de proposition)
        new Date(),
        ctx,
      )
      // No-op non couvert par l'audit de l'orchestrateur → trace HDS de la soumission (sans PHI).
      if (outcome.outcome === "noop") {
        await auditService
          .log({ userId: user.id, action: "INSULIN_SLOT_SUBMISSION", resource: "PATIENT", resourceId: String(patientId), ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId, metadata: { patientId, parameterType, outcome: "noop" } })
          .catch(() => {})
      }
      return NextResponse.json(outcome)
    } catch (e) {
      // Rejet dur à la saisie (bornes/couverture) / doublon / verrou / bascule MDR concurrente → statut HTTP
      // stable + trace HDS de la tentative (jamais 500 ni fuite de stack).
      const reason = e instanceof Error ? e.message : "unknown"
      const status = SLOT_SET_ERROR_STATUS[reason] ?? (reason === "patientNotFound" ? 404 : undefined)
      if (status) {
        await auditService
          .log({ userId: user.id, action: "INSULIN_SLOT_SUBMISSION", resource: "PATIENT", resourceId: String(patientId), ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId, metadata: { patientId, parameterType, outcome: "rejected", reason } })
          .catch(() => {})
        return NextResponse.json({ error: reason }, { status })
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
