/**
 * US-2613 (PR6b-2) — Administration plateforme : validation des preuves PS.
 * ADMIN-only (filtrage serveur ; l'enforcement réel est côté API).
 */
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { PsRegistrationsClient } from "@/components/diabeo/admin/PsRegistrationsClient"

export default async function PsRegistrationsPage() {
  const role = (await headers()).get("x-user-role")
  if (role !== "ADMIN") redirect("/")

  return (
    <main className="flex flex-col gap-6 p-4 lg:p-6">
      <PsRegistrationsClient />
    </main>
  )
}
