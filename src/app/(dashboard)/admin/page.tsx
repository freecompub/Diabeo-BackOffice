/**
 * US-2410 — Dashboard administrateur (page conteneur).
 *
 * Layout : KPI top full-width, BillingCard + ComplianceCard 2-col lg+.
 * Server-side guard : ADMIN-only ; non-ADMIN redirigé `/login`.
 */

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { AdminKpiSection } from "@/components/diabeo/dashboard/admin/AdminKpiSection"
import { BillingCard } from "@/components/diabeo/dashboard/admin/BillingCard"
import { ComplianceCard } from "@/components/diabeo/dashboard/admin/ComplianceCard"

export default async function AdminDashboardPage() {
  const headersList = await headers()
  const role = headersList.get("x-user-role")
  // UX guard — server-side fast bounce ; the actual authorization happens
  // inside the API routes (`auditedRequireRole(req, "ADMIN", …)`). Non-ADMIN
  // bounce goes to `/` so the root role-router sends them to their proper
  // dashboard (DOCTOR → /medecin, NURSE → /infirmier, VIEWER → /patient/…).
  // code-review L3 (re-review) — previously redirected to `/login` which
  //   was misleading (caller IS logged in, just role-mismatched).
  if (role !== "ADMIN") redirect("/")

  const t = await getTranslations()

  return (
    <main className="flex flex-col gap-6 p-4 lg:p-6">
      <h1 className="text-2xl font-semibold">{t("adminDashboard.pageTitle")}</h1>
      <AdminKpiSection />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BillingCard />
        <ComplianceCard />
      </div>
    </main>
  )
}
