/**
 * US-2400 / US-2602 — « Ma journée » (dashboard médecin, page conteneur).
 *
 * Vue jour du médecin. Layout responsive (1 col mobile, 2 col lg+) :
 *   1. Urgences + Rendez-vous du jour (row 2 col)
 *   2. Patients à suivre (full-width)
 *   3. Relances en attente + Propositions d'ajustement en attente (row 2 col)
 *   4. Messages non lus (full-width)
 *   5. Indicateurs clés (KPI) du cabinet
 *
 * Server-side guard : redirect non-DOCTOR/NURSE/ADMIN to login. The
 * (dashboard)/layout.tsx already redirects VIEWER → /patient/dashboard.
 */

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { getLocale, getTranslations } from "next-intl/server"
import { CABINET_TIMEZONE } from "@/lib/cabinet-time"
import { EmergencyCard } from "@/components/diabeo/dashboard/medecin/EmergencyCard"
import { AppointmentCard } from "@/components/diabeo/dashboard/medecin/AppointmentCard"
import { PatientsAtRiskCard } from "@/components/diabeo/dashboard/medecin/PatientsAtRiskCard"
import { KpiSection } from "@/components/diabeo/dashboard/medecin/KpiSection"
// US-2602 (Ma journée) incr. 1 — Relances en attente. Réutilise la query
// infirmier (`nurseRecallQuery`, scopée au portefeuille de l'appelant) + la
// route `/api/dashboard/infirmier/recall-list` (minRole NURSE → DOCTOR éligible).
import { RecallListCard } from "@/components/diabeo/dashboard/infirmier/RecallListCard"
// US-2602 (Ma journée) incr. 2 — Propositions d'ajustement en attente.
import { PendingProposalsCard } from "@/components/diabeo/dashboard/medecin/PendingProposalsCard"
// US-2602 (Ma journée) incr. 3 — Messages non lus (liste).
import { UnreadMessagesCard } from "@/components/diabeo/dashboard/medecin/UnreadMessagesCard"

const ALLOWED_ROLES = new Set(["DOCTOR", "NURSE", "ADMIN"])

export default async function MedecinDashboardPage() {
  const headersList = await headers()
  const role = headersList.get("x-user-role")
  if (!role || !ALLOWED_ROLES.has(role)) redirect("/login")

  const t = await getTranslations("dashboard.medecin")

  // Greeting éditorial (mockup Home v3) : titre Fraunces + date localisée.
  // La date est une valeur formatée (non un littéral JSX) — pas de clé i18n
  // requise ; Intl gère la locale active.
  // timeZone épinglé à Europe/Paris (CABINET_TIMEZONE) comme tout le reste du
  // code horaire : sinon `new Date()` se résout en zone serveur (VPS UTC) et
  // affiche le mauvais jour entre 22 h et minuit heure de Paris.
  const locale = await getLocale()
  const today = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: CABINET_TIMEZONE,
  }).format(new Date())
  // FR/EN rendent le jour de la semaine en minuscule en début de phrase → on
  // capitalise. Inutile/incorrect pour d'autres scripts (ar) → restreint.
  const todayLabel =
    locale === "fr" || locale === "en"
      ? today.charAt(0).toUpperCase() + today.slice(1)
      : today

  return (
    <main className="flex flex-col gap-6 p-4 lg:p-6">
      <header>
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          {t("pageTitle")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{todayLabel}</p>
      </header>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <EmergencyCard />
        <AppointmentCard />
      </div>
      <PatientsAtRiskCard />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RecallListCard />
        <PendingProposalsCard />
      </div>
      <UnreadMessagesCard />
      <KpiSection />
    </main>
  )
}
