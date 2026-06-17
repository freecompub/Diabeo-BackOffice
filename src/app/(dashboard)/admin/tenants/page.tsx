/**
 * US-2613 (PR6b-1) — Administration plateforme : liste des tenants.
 * ADMIN-only (filtrage serveur ; l'enforcement réel est côté API).
 */
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { TenantsListClient } from "@/components/diabeo/admin/TenantsListClient"

export default async function TenantsPage() {
  const role = (await headers()).get("x-user-role")
  if (role !== "ADMIN") redirect("/")

  return (
    <main className="flex flex-col gap-6 p-4 lg:p-6">
      <TenantsListClient />
    </main>
  )
}
