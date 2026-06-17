/**
 * US-2610 (PR4b) — Écran de gestion des membres d'un cabinet — Server Component.
 *
 * Garde **capacité Q2** (gestion) dans le scope du service : seul un membre
 * `canManage` (ou `ADMIN`) accède. Pas de donnée de santé ici (gestion = régime
 * distinct du PHI). L'enforcement réel reste côté routes `/api/cabinet/[id]/members`.
 */

import { headers } from "next/headers"
import { notFound, redirect } from "next/navigation"
import type { Role } from "@prisma/client"
import { canManageOrg } from "@/lib/capabilities"
import { MembersManagementClient } from "@/components/diabeo/cabinet/MembersManagementClient"

export default async function CabinetMembersPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  // Regex stricte (vs parseInt qui tronque "1.5xyz") — id canonique pour l'audit.
  if (!/^[1-9]\d{0,9}$/.test(id)) notFound()
  const cabinetId = Number.parseInt(id, 10)

  const h = await headers()
  const userId = Number(h.get("x-user-id"))
  const role = h.get("x-user-role") as Role | null
  if (!userId || !Number.isInteger(userId) || !role) redirect("/login")

  // Garde Q2 : ADMIN passe ; sinon il faut la capacité de gestion sur CE service.
  if (role !== "ADMIN" && !(await canManageOrg(userId, cabinetId))) {
    notFound() // 404 uniforme (anti-énumération du périmètre cabinet)
  }

  return (
    <main className="flex flex-col gap-6 p-4 lg:p-6">
      <MembersManagementClient cabinetId={cabinetId} />
    </main>
  )
}
