/**
 * US-2102/2108 — Admin gestion factures (page conteneur).
 *
 * ADMIN-only. Liste paginée des factures + filtres status/cabinet/patient.
 * Backend : `GET /api/billing/invoices`.
 */
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { InvoicesListClient } from "@/components/diabeo/admin/InvoicesListClient"

export default async function InvoicesPage() {
  const headersList = await headers()
  const role = headersList.get("x-user-role")
  if (role !== "ADMIN") redirect("/")

  return (
    <main className="flex flex-col gap-6 p-4 lg:p-6">
      <header>
        <h1 className="text-2xl font-semibold">Factures</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Historique des factures émises + brouillons. Cliquer pour détail
          et téléchargement PDF.
        </p>
      </header>
      <InvoicesListClient />
    </main>
  )
}
