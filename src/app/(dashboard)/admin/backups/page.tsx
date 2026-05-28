/**
 * US-2151 Admin gestion backups PostgreSQL (page conteneur).
 *
 * ADMIN-only. Liste des backups + filtres status + déclenchement nouveau backup.
 * Backend : `backupService` (PR #409). Routes : GET/POST `/api/admin/backups`.
 */
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { BackupsListClient } from "@/components/diabeo/admin/BackupsListClient"

export default async function BackupsPage() {
  const headersList = await headers()
  const role = headersList.get("x-user-role")
  if (role !== "ADMIN") redirect("/")

  return (
    <main className="flex flex-col gap-6 p-4 lg:p-6">
      <header>
        <h1 className="text-2xl font-semibold">Backups PostgreSQL</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Historique des backups DB + déclenchement manuel. Backup automatique
          quotidien via cron (cf. <code>docs/runbook/postgres-backup.md</code>).
        </p>
      </header>
      <BackupsListClient />
    </main>
  )
}
