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
  // Fix H5 round 1 review PR #459 (HSA M2) — regex stricte vs parseInt
  // accepting "1.5xyz" / "1e10" silent truncate. URL `/admin/cabinets/1.5`
  // pourrait polluer audit US-2268 avec resourceId non-canonique.
  if (!/^[1-9]\d{0,9}$/.test(id)) {
    redirect("/admin/cabinets")
  }
  const cabinetId = Number.parseInt(id, 10)

  return (
    <main className="flex flex-col gap-6 p-4 lg:p-6">
      <CabinetDetailClient cabinetId={cabinetId} />
    </main>
  )
}
