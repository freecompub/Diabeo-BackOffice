/**
 * US-2500-UI iter 12 — Page patient "Mes RDV" (vue read-only + accept alt).
 *
 * Cohabite avec l'app iOS Diabeo qui est la surface principale patient.
 * Cette page web sert pour :
 *   - patients sans iPhone récent
 *   - secrétariat / aidant qui aide un patient depuis le navigateur
 *   - accès depuis poste cabinet en cas de session iOS expirée
 *
 * **Server-side guard** : VIEWER (gated par `(patient)/layout.tsx`).
 *
 * **Sécurité** :
 *   - `force-dynamic` + Cache-Control no-store (middleware `/patient/*`) →
 *     PHI jamais en bfcache / proxy (Fix C1 round 1 review PR #438)
 *   - `getOwnPatientId(userId)` résout le patient.id du user connecté
 *   - Si null (cas rare : VIEWER orphelin sans Patient row → migration in-flight
 *     ou compte démo) → audit `viewer.no_patient_row` + message clair
 *   - `requireGdprConsent(userId)` upfront → redirect /account/privacy si OFF
 *     (Fix M6 round 1 review PR #438)
 *   - Audit `accessDenied` si mismatch role / userId invalide
 *     (Fix H6 round 1 review PR #438)
 *   - useAppointments(patientId=self) côté client passe au backend qui
 *     applique RBAC + audit US-2268
 *
 * **Différences vs calendrier pro** :
 *   - Pas de Schedule-X grid (overkill pour patient — 5-30 RDV typiques)
 *   - Liste chronologique simple (prochains RDV en haut)
 *   - Pas de drag&drop, pas de create (patient n'crée pas, c'est le pro)
 *   - Bouton "Accepter alternative" si propAlt + status=cancelled
 *
 * @see docs/UserStory/pro-user-stories/23-rdv/US-2500-UI-calendrier-rdv-pro.md
 */

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { isKnownRoleString } from "@/lib/auth/role-home"
import { getOwnPatientId } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { auditService } from "@/lib/services/audit.service"
import { MyAppointmentsList } from "@/components/diabeo/appointments/MyAppointmentsList"

/**
 * Fix C1 round 1 review PR #438 — `force-dynamic` empêche le caching Next.js
 * du HTML SSR (PHI). Le Cache-Control HTTP no-store est posé par le
 * middleware sur `/patient/*` (defense-in-depth navigateur + proxy + bfcache).
 */
export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function MyAppointmentsPage() {
  const headersList = await headers()
  const role = headersList.get("x-user-role")
  const userIdStr = headersList.get("x-user-id")
  const ipAddress = headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"
  const userAgent = headersList.get("user-agent") ?? "unknown"
  const requestId = headersList.get("x-request-id") ?? "no-request-id"
  const ctx = { ipAddress, userAgent, requestId }

  // Fail-safe : si middleware ne tourne pas → login.
  if (!isKnownRoleString(role) || !userIdStr) redirect("/login")

  const userId = Number.parseInt(userIdStr, 10)
  if (!Number.isInteger(userId) || userId <= 0) redirect("/login")

  // Fix H6 round 1 review PR #438 — Le layout (patient) gate déjà VIEWER, mais
  // defense-in-depth ici + audit accessDenied (US-2265 burst detection).
  if (role !== "VIEWER") {
    await auditService.accessDenied({
      userId, resource: "PATIENT", resourceId: String(userId),
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
      metadata: { endpoint: "/patient/appointments", attemptedRole: role },
    }).catch(() => { /* fire-and-forget — never block on audit */ })
    redirect("/login")
  }

  // Fix M6 round 1 review PR #438 — Consent RGPD Art. 9 upfront server-side.
  // Sans ça, l'UI affichait une erreur générique au lieu de rediriger vers
  // le flow consent.
  const hasConsent = await requireGdprConsent(userId)
  if (!hasConsent) redirect("/account/privacy?redirect=/patient/appointments")

  const patientId = await getOwnPatientId(userId)
  const t = await getTranslations("appointments")

  // Fix H6 round 1 review PR #438 — Audit VIEWER orphelin pour détecter
  // compte démo recyclé ou migration ratée.
  if (patientId === null) {
    await auditService.log({
      userId, action: "READ", resource: "PATIENT", resourceId: String(userId),
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
      metadata: { kind: "viewer.no_patient_row", endpoint: "/patient/appointments" },
    }).catch(() => { /* fire-and-forget */ })
  }

  return (
    <main
      className="flex flex-col gap-6 p-4 lg:p-6"
      aria-labelledby="my-appointments-title"
    >
      {/* Fix M13 round 1 review PR #438 — skip-link WCAG 2.4.1 Bypass Blocks
          cohérent avec la page pro `(dashboard)/appointments/page.tsx`. */}
      <a
        href="#my-appointments-list"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:start-2 focus:z-50 focus:rounded focus:bg-teal-800 focus:px-3 focus:py-2 focus:text-white focus-visible:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
      >
        {t("skipToList")}
      </a>
      <header>
        <h1 id="my-appointments-title" className="text-2xl font-semibold">
          {t("myAppointmentsTitle")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("myAppointmentsSubtitle")}
        </p>
      </header>

      {patientId === null ? (
        // Fix M7 round 1 review PR #438 — message unifié vs `myAppointmentsError`
        // pour ne pas distinguer "orphelin" vs "erreur réseau" côté UI
        // (anti-énumération état compte).
        <div
          id="my-appointments-list"
          role="alert"
          className="rounded-md border border-amber-600 bg-amber-50 p-4 text-sm text-amber-900"
        >
          {t("myAppointmentsUnavailable")}
        </div>
      ) : (
        <MyAppointmentsList patientId={patientId} />
      )}
    </main>
  )
}
