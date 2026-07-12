/**
 * PUT /api/patient/insulin-slot-set — **SOUMISSION SELF-SERVICE PATIENT** d'un jeu de créneaux ISF/ICR.
 * Le patient soumet sa **disposition complète** (mono-paramètre) ; elle est **TOUJOURS** enregistrée comme
 * **proposition d'ensemble** (`SlotSetProposal` pending), soumise à la **revue MÉDECIN** (C3d). Il n'existe
 * plus d'auto-application : une soumission patient ne modifie JAMAIS directement la configuration active.
 *
 * `createSetProposal` supersède les propositions `pending` du même `(patient × paramètre)` (d'ensemble ET
 * par-valeur) et valide DÈS la création la forme + les bornes cliniques/couverture (`assertValidSlotSet`),
 * ainsi que la frontière dispositif médical (patient non insuliné → refus).
 *
 * **Own-id STRICT (anti-IDOR / anti-énumération)** : patient résolu EXCLUSIVEMENT depuis `user.id` via
 * `getOwnPatientId` — **aucun** `?patientId`, **aucun** token. Frontière d'autorisation = `getOwnPatientId`
 * seul (pas de garde de rôle). **Invariant dont dépend l'anti-IDOR** : `Patient.userId @unique` → un
 * `user.id` mappe AU PLUS un dossier (le sien) ; un pro sans dossier → 404 neutre. Si cette cardinalité
 * change un jour, ré-introduire un garde de rôle explicite. Consentement RGPD requis ; rate-limit anti-abus.
 * La création de proposition est auditée par le service (`CREATE SLOT_SET_PROPOSAL`) ; la route trace en plus
 * les rejets durs à la saisie (bornes/couverture/doublon) via `INSULIN_SLOT_SUBMISSION`. Valeurs ISF en
 * **g/L**, ICR en **g/U** (bornes re-validées serveur).
 *
 * Réponse : `201 { outcome: "proposal", proposalId }`. Rejet dur à la saisie (bornes/couverture) / doublon
 * pending / patient non insuliné → statut HTTP 4xx (jamais 500 ni fuite de stack).
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth, AuthError } from "@/lib/auth"
import { checkApiRateLimit, RATE_LIMITS } from "@/lib/auth/api-rate-limit"
import { getOwnPatientId } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { slotSetProposalService } from "@/lib/services/slot-set-proposal.service"
import { SLOT_SET_ERROR_STATUS } from "@/lib/insulin/slot-set-errors"
import { isfIcrSlotSchema } from "@/lib/insulin/grouped-proposal"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"

const bodySchema = z.object({
  parameterType: z.enum(["insulinSensitivityFactor", "insulinToCarbRatio"]),
  // US-2663 — forme des créneaux importée du module de typage unique (`isfIcrSlotSchema`), plus de copie
  // inline. Les bornes cliniques (ISF/ICR) sont re-validées serveur par `assertValidSlotSet` (→ valueOutOfBounds/400).
  // `.min(1).max(24)` restent locaux à la route (borne anti-abus : 24 créneaux couvrent 24 h).
  slots: isfIcrSlotSchema.array().min(1).max(24),
})

export async function PUT(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const ctx = extractRequestContext(req)

    // Rate-limit (ANSSI, anti-abus) : écriture patient. Fail-open (dispo d'abord). Saturation auditée.
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
      // TOUJOURS une proposition médecin (plus d'auto-application). `createSetProposal` supersède les pending
      // du même paramètre et audite la création (`CREATE SLOT_SET_PROPOSAL`). Provenance `source` dérivée de
      // la SESSION (US-2663/ADR #27) : cette voie est patient-only (`getOwnPatientId`) → toujours `patient`.
      const { id } = await slotSetProposalService.createSetProposal(
        patientId,
        parameterType,
        slots,
        { userId: user.id, source: "patient" },
        ctx,
      )
      return NextResponse.json({ outcome: "proposal", proposalId: id }, { status: 201 })
    } catch (e) {
      // Rejet dur à la saisie (bornes/couverture) / doublon pending / patient non insuliné → statut HTTP stable
      // + trace HDS de la tentative (jamais 500 ni fuite de stack).
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
