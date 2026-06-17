/**
 * US-2613 (PR6b-1) — Administration plateforme : détail d'un tenant.
 * ADMIN-only (filtrage serveur ; l'enforcement réel est côté API).
 */
import { headers } from "next/headers"
import { notFound, redirect } from "next/navigation"
import { TenantDetailClient } from "@/components/diabeo/admin/TenantDetailClient"

export default async function TenantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const role = (await headers()).get("x-user-role")
  if (role !== "ADMIN") redirect("/")

  const { id } = await params
  if (!/^[1-9]\d{0,9}$/.test(id)) notFound()

  return (
    <main className="flex flex-col gap-6 p-4 lg:p-6">
      <TenantDetailClient tenantId={Number.parseInt(id, 10)} />
    </main>
  )
}
