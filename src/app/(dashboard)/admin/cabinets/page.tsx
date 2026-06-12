/**
 * US-2117/2118/2506 Admin gestion cabinets (page conteneur).
 *
 * ADMIN-only. Liste paginée des cabinets + lien vers détail (settings +
 * SMS config). Backend : `GET /api/admin/healthcare-services`.
 */
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { CabinetsListClient } from "@/components/diabeo/admin/CabinetsListClient"

export default async function CabinetsListPage() {
  const headersList = await headers()
  const role = headersList.get("x-user-role")
  if (role !== "ADMIN") redirect("/")
  const t = await getTranslations("admin")

  return (
    <main className="flex flex-col gap-6 p-4 lg:p-6">
      <header>
        <h1 className="text-2xl font-semibold">{t("cabinets.title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("cabinets.subtitle")}
        </p>
      </header>
      <CabinetsListClient />
    </main>
  )
}
