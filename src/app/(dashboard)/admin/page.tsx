/**
 * US-2410 — Dashboard administrateur (page conteneur).
 *
 * Layout : KPI top full-width, BillingCard + ComplianceCard 2-col lg+.
 * Server-side guard : ADMIN-only ; non-ADMIN redirigé `/login`.
 */

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { AdminKpiSection } from "@/components/diabeo/dashboard/admin/AdminKpiSection"
import { BillingCard } from "@/components/diabeo/dashboard/admin/BillingCard"
import { ComplianceCard } from "@/components/diabeo/dashboard/admin/ComplianceCard"

export default async function AdminDashboardPage() {
  const headersList = await headers()
  const role = headersList.get("x-user-role")
  if (role !== "ADMIN") redirect("/login")

  return (
    <main className="flex flex-col gap-6 p-4 lg:p-6">
      <h1 className="text-2xl font-semibold">Tableau de bord administrateur</h1>
      <AdminKpiSection />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BillingCard />
        <ComplianceCard />
      </div>
    </main>
  )
}
