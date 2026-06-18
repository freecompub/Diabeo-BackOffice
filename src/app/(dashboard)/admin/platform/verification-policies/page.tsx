/**
 * US-2613 (PR6b-2) — Administration plateforme : politique de vérification PS.
 * ADMIN-only (filtrage serveur ; l'enforcement réel est côté API).
 */
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { VerificationPolicyClient } from "@/components/diabeo/admin/VerificationPolicyClient"

export default async function VerificationPoliciesPage() {
  const role = (await headers()).get("x-user-role")
  if (role !== "ADMIN") redirect("/")

  return (
    <main className="flex flex-col gap-6 p-4 lg:p-6">
      <VerificationPolicyClient />
    </main>
  )
}
