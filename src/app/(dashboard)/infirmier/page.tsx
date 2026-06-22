/**
 * US-2405 — Dashboard infirmier (page conteneur).
 *
 * Layout responsive : 1 col mobile, 2 col lg+ pour Todo+TeamInbox,
 * KPI en haut full-width, Recall en bas full-width.
 *
 * Server-side guard : NURSE/DOCTOR/ADMIN (DOCTOR+ peut aussi voir
 * pour assister les NURSE). VIEWER redirigé par (dashboard)/layout.tsx.
 */

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { getLocale, getTranslations } from "next-intl/server"
import { CABINET_TIMEZONE } from "@/lib/cabinet-time"
import { getCurrentUserDisplayName } from "@/lib/auth/current-user-name"
import { NurseKpiSection } from "@/components/diabeo/dashboard/infirmier/NurseKpiSection"
import { TodoListCard } from "@/components/diabeo/dashboard/infirmier/TodoListCard"
import { TeamInboxCard } from "@/components/diabeo/dashboard/infirmier/TeamInboxCard"
import { RecallListCard } from "@/components/diabeo/dashboard/infirmier/RecallListCard"

const ALLOWED_ROLES = new Set(["NURSE", "DOCTOR", "ADMIN"])

export default async function InfirmierDashboardPage() {
  const headersList = await headers()
  const role = headersList.get("x-user-role")
  if (!role || !ALLOWED_ROLES.has(role)) redirect("/login")

  const t = await getTranslations("dashboardCards.nursePage")

  // Greeting éditorial (mockup Home v3) — même logique que le home médecin :
  // titre Fraunces + sous-titre « Bonjour, {nom} · {date} ». Date épinglée à
  // Europe/Paris (CABINET_TIMEZONE). Nom via le lookup self request-cached.
  const locale = await getLocale()
  const today = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: CABINET_TIMEZONE,
  }).format(new Date())
  const todayLabel =
    locale === "fr" || locale === "en"
      ? today.charAt(0).toUpperCase() + today.slice(1)
      : today

  const rawUserId = headersList.get("x-user-id")
  const userId = rawUserId ? Number(rawUserId) : NaN
  const name =
    Number.isInteger(userId) && userId > 0
      ? await getCurrentUserDisplayName(userId)
      : null
  // Titre honorifique (« M. », « Dr ») préfixé seulement en fr/en.
  const useTitle = locale === "fr" || locale === "en"
  const greetingName = name?.lastname
    ? `${useTitle && name.title ? `${name.title} ` : ""}${name.lastname}`
    : (name?.firstname ?? null)
  const subtitle = greetingName
    ? `${t("greeting", { name: greetingName })} · ${todayLabel}`
    : todayLabel

  return (
    <main className="flex flex-col gap-6 p-4 lg:p-6">
      <header>
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          {t("title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </header>
      <NurseKpiSection />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TodoListCard />
        <TeamInboxCard />
      </div>
      <RecallListCard />
    </main>
  )
}
