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
import { getTranslations } from "next-intl/server"
import { DashboardGreeting } from "@/components/diabeo/dashboard/DashboardGreeting"
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

  return (
    <main className="flex flex-col gap-6 p-4 lg:p-6">
      <DashboardGreeting
        title={t("title")}
        greeting={(name) => t("greeting", { name })}
      />
      <NurseKpiSection />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TodoListCard />
        <TeamInboxCard />
      </div>
      <RecallListCard />
    </main>
  )
}
