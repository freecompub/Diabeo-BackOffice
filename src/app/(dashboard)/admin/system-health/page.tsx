/**
 * US-2150 Dashboard santé système (page conteneur).
 *
 * ADMIN-only. Vue temps-réel : DB / Redis / CGM ingestion lag / backups
 * freshness / active sessions / unauthorized attempts 24h.
 *
 * Backend : `systemHealthService.snapshot` (PR #409 Groupe 9 Admin/Ops).
 */
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { SystemHealthClient } from "@/components/diabeo/admin/SystemHealthClient"

export default async function SystemHealthPage() {
  const headersList = await headers()
  const role = headersList.get("x-user-role")
  if (role !== "ADMIN") redirect("/")

  return (
    <main className="flex flex-col gap-6 p-4 lg:p-6">
      <header>
        <h1 className="text-2xl font-semibold">Santé système</h1>
        <p className="text-sm text-muted-foreground mt-1">
          État temps-réel des composants critiques (DB, Redis, CGM, backups).
          Refresh automatique toutes les 60s.
        </p>
      </header>
      <SystemHealthClient />
    </main>
  )
}
