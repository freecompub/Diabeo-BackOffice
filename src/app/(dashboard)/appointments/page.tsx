/**
 * US-2500-UI — Calendrier RDV pro (page conteneur).
 *
 * Layout : page client-component encapsulant le `<AppointmentCalendar>`
 * qui consomme `/api/appointments/*` (backend US-2500 DONE PR #392).
 *
 * Server-side guard : NURSE+ (NURSE/DOCTOR/ADMIN) — un VIEWER tombe sur
 * son propre dashboard via le pattern role-home (`src/lib/auth/role-home.ts`).
 *
 * Étape scaffold (PR initiale) :
 *   - Page minimale qui rend le calendrier vide
 *   - Filtres / modal CRUD / workflow alternatives livrés dans les
 *     commits suivants de cette même PR
 *
 * @see docs/UserStory/pro-user-stories/23-rdv/US-2500-UI-calendrier-rdv-pro.md
 * @see issue GH #428
 */

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { isKnownRoleString, resolveHomeForRole } from "@/lib/auth/role-home"
import { AppointmentCalendarLazy } from "@/components/diabeo/appointments/AppointmentCalendarLazy"

export default async function AppointmentsPage() {
  const headersList = await headers()
  const role = headersList.get("x-user-role")

  // Fail-safe : si middleware ne tourne pas (matcher manquant) → login.
  if (!isKnownRoleString(role)) redirect("/login")

  // VIEWER → home role-specific (pas de calendrier pro pour patient).
  if (role === "VIEWER") redirect(resolveHomeForRole(role))

  const t = await getTranslations("appointments")

  return (
    <main className="flex flex-col gap-6 p-4 lg:p-6">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t("pageTitle")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("pageSubtitle")}</p>
        </div>
      </header>

      <AppointmentCalendarLazy />
    </main>
  )
}
