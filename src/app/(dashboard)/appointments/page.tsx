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
    <main
      className="flex flex-col gap-6 p-4 lg:p-6"
      // Fix US-2500-UI iter 10 a11y polish — landmark main lié au h1 page.
      aria-labelledby="appointments-page-title"
    >
      {/* US-2500-UI iter 10 a11y polish — skip-link visible only on focus
          (WCAG 2.4.1 Bypass Blocks AA). Permet à un user clavier-only ou
          SR de sauter le header + filtres pour aller direct au calendrier
          (qui peut contenir 200+ RDV). Le link reste invisible sauf focus
          via la classe `sr-only focus:not-sr-only`.

          Fix A11Y-1 round 1 review PR #437 — `bg-teal-800` (#115E59) sur
          white = contraste 7.1:1 (WCAG AAA). L'ancien `bg-primary` teal-600
          (#0D9488) donnait 3.74:1 (FAIL WCAG AA 4.5:1).

          Fix A11Y-2 round 1 — `focus:start-2` (vs `focus:left-2`) Tailwind
          logical property → respecte automatiquement `dir="rtl"` arabe :
          skip-link à droite en RTL, à gauche en LTR.

          Fix CR-5 round 1 — `focus-visible:outline-none` (vs `focus:`)
          cohérent avec wrapper calendar pour éviter outline natif sur clic
          souris involontaire. */}
      <a
        href="#appointment-calendar-main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:start-2 focus:z-50 focus:rounded focus:bg-teal-800 focus:px-3 focus:py-2 focus:text-white focus-visible:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
      >
        {t("skipToCalendar")}
      </a>
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h1 id="appointments-page-title" className="text-2xl font-semibold">
            {t("pageTitle")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("pageSubtitle")}</p>
        </div>
      </header>

      {/* US-2500-UI iter 5 — passe `userRole` au calendrier pour gater le
          bouton "Proposer alternative" (DOCTOR+) du modal détail RDV. */}
      <AppointmentCalendarLazy userRole={role} />
    </main>
  )
}
