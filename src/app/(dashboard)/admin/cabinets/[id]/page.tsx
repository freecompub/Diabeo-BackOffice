/**
 * US-2117/2118 + US-2506 — Cabinet detail (settings + SMS config).
 *
 * ADMIN-only. 2 sections : settings éditables manager-level (phone, address,
 * specialties, capacity, openingHours) + SMS config V1 mock (toggle + crédits).
 */
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { CabinetDetailClient } from "@/components/diabeo/admin/CabinetDetailClient"

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function CabinetDetailPage({ params }: PageProps) {
  const headersList = await headers()
  const role = headersList.get("x-user-role")
  if (role !== "ADMIN") redirect("/")

  const { id } = await params
  const cabinetId = Number.parseInt(id, 10)
  if (!Number.isFinite(cabinetId) || cabinetId <= 0) {
    redirect("/admin/cabinets")
  }

  return (
    <main className="flex flex-col gap-6 p-4 lg:p-6">
      <CabinetDetailClient cabinetId={cabinetId} />
    </main>
  )
}
