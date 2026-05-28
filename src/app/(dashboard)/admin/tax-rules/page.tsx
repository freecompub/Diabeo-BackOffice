/**
 * US-2110 — Tax rules admin (lecture seule).
 *
 * ADMIN-only. Résolution taux fiscal actif (countryCode + taxType + date).
 * Backend : `GET /api/config/tax-rules/active`.
 */
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { TaxRulesClient } from "@/components/diabeo/admin/TaxRulesClient"

export default async function TaxRulesPage() {
  const headersList = await headers()
  const role = headersList.get("x-user-role")
  if (role !== "ADMIN") redirect("/")

  return (
    <main className="flex flex-col gap-6 p-4 lg:p-6">
      <header>
        <h1 className="text-2xl font-semibold">Règles fiscales</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Résolution du taux fiscal actif pour un pays + type de taxe à une
          date donnée. Lecture seule iter 5 — création/modification via
          backend opérations (cf. <code>docs/runbook/tax-rules.md</code>).
        </p>
      </header>
      <TaxRulesClient />
    </main>
  )
}
