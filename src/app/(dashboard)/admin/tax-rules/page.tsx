/**
 * US-2110 — Tax rules admin (lecture seule).
 *
 * ADMIN-only. Résolution taux fiscal actif (countryCode + taxType + date).
 * Backend : `GET /api/config/tax-rules/active`.
 */
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { TaxRulesClient } from "@/components/diabeo/admin/TaxRulesClient"

export default async function TaxRulesPage() {
  const headersList = await headers()
  const role = headersList.get("x-user-role")
  if (role !== "ADMIN") redirect("/")
  const t = await getTranslations("admin")

  return (
    <main className="flex flex-col gap-6 p-4 lg:p-6">
      <header>
        <h1 className="text-2xl font-semibold">{t("taxRules.title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t.rich("taxRules.subtitle", { code: (c) => <code>{c}</code> })}
        </p>
      </header>
      <TaxRulesClient />
    </main>
  )
}
