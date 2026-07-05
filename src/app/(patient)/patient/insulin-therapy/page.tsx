/**
 * US-2650 — Page patient « Mon insulinothérapie » (self-service, LECTURE).
 *
 * Surface web patient (cohabite avec l'app iOS). Affiche, en lecture seule et
 * **mode-aware**, la thérapie du patient connecté : créneaux ISF/ICR, schéma basal,
 * insuline bolus. Aucune écriture directe (le patient PROPOSE via une tranche
 * ultérieure ; validation DOCTOR — ADR #13).
 *
 * **Sécurité (own-id strict, anti-IDOR / anti-énumération)** :
 *  - `force-dynamic` + Cache-Control no-store (middleware `/patient/*`) → PHI hors bfcache/proxy.
 *  - VIEWER gaté par `(patient)/layout.tsx` + defense-in-depth `accessDenied` ici.
 *  - `getOwnPatientId(userId)` résout le patient **exclusivement** depuis la session
 *    (jamais d'`?patientId` ni de jeton). `null` → message unifié « indisponible ».
 *  - `requireGdprConsent(userId)` upfront (Art. 9). Lecture santé auditée par les services.
 */

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { isKnownRoleString } from "@/lib/auth/role-home"
import { getOwnPatientId } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { auditService } from "@/lib/services/audit.service"
import { patientService } from "@/lib/services/patient.service"
import { insulinTherapyService } from "@/lib/services/insulin-therapy.service"
import { buildTreatmentView } from "@/app/(dashboard)/patients/[id]/treatment-view"
import { PatientInsulinClient } from "@/components/diabeo/patient/PatientInsulinClient"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function PatientInsulinTherapyPage() {
  const headersList = await headers()
  const role = headersList.get("x-user-role")
  const userIdStr = headersList.get("x-user-id")
  const ipAddress = headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"
  const userAgent = headersList.get("user-agent") ?? "unknown"
  const requestId = headersList.get("x-request-id") ?? "no-request-id"
  const ctx = { ipAddress, userAgent, requestId }

  if (!isKnownRoleString(role) || !userIdStr) redirect("/login")
  const userId = Number.parseInt(userIdStr, 10)
  if (!Number.isInteger(userId) || userId <= 0) redirect("/login")

  // Le layout (patient) gate déjà VIEWER — defense-in-depth + audit accessDenied.
  if (role !== "VIEWER") {
    await auditService
      .accessDenied({
        userId, resource: "PATIENT", resourceId: String(userId),
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        metadata: { endpoint: "/patient/insulin-therapy", attemptedRole: role },
      })
      .catch(() => { /* fire-and-forget — ne jamais bloquer sur l'audit */ })
    redirect("/login")
  }

  const hasConsent = await requireGdprConsent(userId)
  if (!hasConsent) redirect("/account/privacy?redirect=/patient/insulin-therapy")

  const patientId = await getOwnPatientId(userId)
  const t = await getTranslations("patientInsulin")

  if (patientId === null) {
    // VIEWER orphelin (compte démo / migration) → audité + message unifié (anti-énumération).
    await auditService
      .log({
        userId, action: "READ", resource: "PATIENT", resourceId: String(userId),
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
        metadata: { kind: "viewer.no_patient_row", endpoint: "/patient/insulin-therapy" },
      })
      .catch(() => { /* fire-and-forget */ })
  }

  // Assemblage LECTURE minimal (RGPD Art. 5) : settings + traitements uniquement — jamais
  // `getById` (qui déchiffrerait identité + antécédents inutiles ici). Try/catch → dégradation
  // gracieuse vers l'alerte « indisponible » (jamais de 500 ni de stack au patient).
  let treatmentView: ReturnType<typeof buildTreatmentView> | null = null
  if (patientId !== null) {
    try {
      const settings = await insulinTherapyService.getSettings(patientId, userId, ctx)
      const treatments = await patientService.getTreatments(patientId, userId, ctx)
      treatmentView = buildTreatmentView(settings, treatments, [])
    } catch {
      treatmentView = null
    }
  }

  return (
    <main className="flex flex-col gap-6 p-4 lg:p-6" aria-labelledby="patient-insulin-title">
      <a
        href="#patient-insulin-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:start-2 focus:z-50 focus:rounded focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground focus-visible:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
      >
        {t("skipToContent")}
      </a>
      <header>
        <h1 id="patient-insulin-title" className="text-2xl font-semibold">
          {t("title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>

      <div id="patient-insulin-content">
        {treatmentView !== null && patientId !== null ? (
          <PatientInsulinClient patientId={patientId} data={treatmentView} />
        ) : (
          <div role="status" className="rounded-md border border-feedback-warning bg-feedback-warning-bg p-4 text-sm text-feedback-warning-fg">
            {t("unavailable")}
          </div>
        )}
      </div>
    </main>
  )
}
