/**
 * US-2148 — Admin gestion utilisateurs (page conteneur).
 *
 * ADMIN-only. Liste paginée + filtres role/status.
 * Backend : `GET /api/admin/users`.
 */
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { UsersListClient } from "@/components/diabeo/admin/UsersListClient"

export default async function UsersPage() {
  const headersList = await headers()
  const role = headersList.get("x-user-role")
  if (role !== "ADMIN") redirect("/")
  const t = await getTranslations("admin")

  return (
    <main className="flex flex-col gap-6 p-4 lg:p-6">
      <header>
        <h1 className="text-2xl font-semibold">{t("users.title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("users.subtitle")}
        </p>
      </header>
      <UsersListClient />
    </main>
  )
}
