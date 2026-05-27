/**
 * US-2137 Notification violation CNIL — detail page + FSM workflow.
 *
 * ADMIN-only. Affiche détail d'une violation + transitions FSM autorisées
 * (draft → under_assessment → notified_cnil → notified_users → closed).
 */
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { DataBreachDetailClient } from "@/components/diabeo/admin/DataBreachDetailClient"

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function DataBreachDetailPage({ params }: PageProps) {
  const headersList = await headers()
  const role = headersList.get("x-user-role")
  if (role !== "ADMIN") redirect("/")

  const { id } = await params
  const breachId = Number.parseInt(id, 10)
  if (!Number.isFinite(breachId) || breachId <= 0) {
    redirect("/admin/data-breaches")
  }

  return (
    <main className="flex flex-col gap-6 p-4 lg:p-6">
      <DataBreachDetailClient breachId={breachId} />
    </main>
  )
}
