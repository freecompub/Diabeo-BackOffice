/**
 * US-2400 — Dashboard médecin (page conteneur).
 *
 * Layout responsive : 1 col mobile, 2 col grid lg+. Urgences + RDV top row
 * (parallel), Patients à suivre row 2 full-width, KPI section row 3.
 *
 * Server-side guard : redirect non-DOCTOR/NURSE/ADMIN to login. The
 * (dashboard)/layout.tsx already redirects VIEWER → /patient/dashboard.
 */

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { EmergencyCard } from "@/components/diabeo/dashboard/medecin/EmergencyCard"
import { AppointmentCard } from "@/components/diabeo/dashboard/medecin/AppointmentCard"
import { PatientsAtRiskCard } from "@/components/diabeo/dashboard/medecin/PatientsAtRiskCard"
import { KpiSection } from "@/components/diabeo/dashboard/medecin/KpiSection"

const ALLOWED_ROLES = new Set(["DOCTOR", "NURSE", "ADMIN"])

export default async function MedecinDashboardPage() {
  const headersList = await headers()
  const role = headersList.get("x-user-role")
  if (!role || !ALLOWED_ROLES.has(role)) redirect("/login")

  const t = await getTranslations("dashboard.medecin")

  return (
    <main className="flex flex-col gap-6 p-4 lg:p-6">
      <h1 className="text-2xl font-semibold">{t("pageTitle")}</h1>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <EmergencyCard />
        <AppointmentCard />
      </div>
      <PatientsAtRiskCard />
      <KpiSection />
    </main>
  )
}
