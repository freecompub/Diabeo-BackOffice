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
 *   - `getOwnPatientId(userId)` résout le patient.id du user connecté
 *   - Si null (cas rare : VIEWER orphelin sans Patient row → migration in-flight
 *     ou compte démo) → message d'erreur clair, pas de 500
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
import { MyAppointmentsList } from "@/components/diabeo/appointments/MyAppointmentsList"

export default async function MyAppointmentsPage() {
  const headersList = await headers()
  const role = headersList.get("x-user-role")
  const userIdStr = headersList.get("x-user-id")

  // Fail-safe : si middleware ne tourne pas → login.
  if (!isKnownRoleString(role) || !userIdStr) redirect("/login")

  // Le layout (patient) gate déjà VIEWER, mais defense-in-depth ici.
  if (role !== "VIEWER") redirect("/login")

  const userId = Number(userIdStr)
  if (!Number.isFinite(userId) || userId <= 0) redirect("/login")

  const patientId = await getOwnPatientId(userId)
  const t = await getTranslations("appointments")

  return (
    <main
      className="flex flex-col gap-6 p-4 lg:p-6"
      aria-labelledby="my-appointments-title"
    >
      <header>
        <h1 id="my-appointments-title" className="text-2xl font-semibold">
          {t("myAppointmentsTitle")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("myAppointmentsSubtitle")}
        </p>
      </header>

      {patientId === null ? (
        // Cas rare : VIEWER sans Patient row associé (compte démo / migration).
        <div role="alert" className="rounded-md border border-amber-500/40 bg-amber-50 p-4 text-sm text-amber-900">
          {t("myAppointmentsNoProfile")}
        </div>
      ) : (
        <MyAppointmentsList patientId={patientId} />
      )}
    </main>
  )
}
