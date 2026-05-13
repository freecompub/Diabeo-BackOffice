/**
 * @module consent
 * @description Patient-side consent helpers — enforce target patient's
 * `UserPrivacySettings.shareWithProviders` and `gdprConsent` flags on per-
 * patient analytics endpoints.
 *
 * `requireGdprConsent` (in `src/lib/gdpr.ts`) only checks the caller's own
 * consent. For PRO-side reads of patient data, the relevant flag is the
 * patient's own — RGPD Art. 7.3 mandates that consent revocation takes
 * effect immediately, including on aggregated analytics.
 */

import { prisma } from "@/lib/db/client"

export type PatientConsentResult =
  | { ok: true }
  | { ok: false; status: 403; error: "sharingDisabled" | "patientConsentMissing" }
  | { ok: false; status: 404; error: "patientNotFound" }

/**
 * Returns ok=true only when:
 *  - the patient exists (not soft-deleted), AND
 *  - the patient's `gdprConsent=true` (we treat absence of privacy settings
 *    as fail-closed, matching the population analytics filter), AND
 *  - `shareWithProviders=true`.
 *
 * Used by per-patient analytics routes (heatmap, compare, agp, agp/pdf, etc.)
 * so a patient who revoked sharing is no longer surfaced to clinicians.
 */
export async function patientShareConsent(patientId: number): Promise<PatientConsentResult> {
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, deletedAt: null },
    select: {
      userId: true,
      user: {
        select: {
          privacySettings: {
            select: { gdprConsent: true, shareWithProviders: true },
          },
        },
      },
    },
  })
  if (!patient) return { ok: false, status: 404, error: "patientNotFound" }

  const privacy = patient.user.privacySettings
  // Fail-closed: missing UserPrivacySettings row means consent not given.
  if (!privacy?.gdprConsent) {
    return { ok: false, status: 403, error: "patientConsentMissing" }
  }
  if (!privacy.shareWithProviders) {
    return { ok: false, status: 403, error: "sharingDisabled" }
  }
  return { ok: true }
}
