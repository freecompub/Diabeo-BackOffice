/**
 * US-2148 — Admin gestion utilisateurs (page conteneur).
 *
 * ADMIN-only. Liste paginée + filtres role/status.
 * Backend : `GET /api/admin/users`.
 */
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { UsersListClient } from "@/components/diabeo/admin/UsersListClient"

export default async function UsersPage() {
  const headersList = await headers()
  const role = headersList.get("x-user-role")
  if (role !== "ADMIN") redirect("/")

  return (
    <main className="flex flex-col gap-6 p-4 lg:p-6">
      <header>
        <h1 className="text-2xl font-semibold">Utilisateurs</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Gestion des comptes utilisateurs (admins, médecins, infirmier·ères, patients).
          Cliquer pour détail + actions suspension/archivage.
        </p>
      </header>
      <UsersListClient />
    </main>
  )
}
