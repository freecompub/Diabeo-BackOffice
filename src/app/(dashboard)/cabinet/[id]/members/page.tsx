/**
 * US-2610 (PR4b) — Écran de gestion des membres d'un cabinet — Server Component.
 *
 * Garde **capacité Q2** (gestion) dans le scope du service : seul un membre
 * `canManage` (ou `ADMIN`) accède. Pas de donnée de santé ici (gestion = régime
 * distinct du PHI). L'enforcement réel reste côté routes `/api/cabinet/[id]/members`.
 */

import { requireCabinetManagementAccess } from "@/lib/cabinet-access"
import { MembersManagementClient } from "@/components/diabeo/cabinet/MembersManagementClient"

export default async function CabinetMembersPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { cabinetId } = await requireCabinetManagementAccess(id)

  return (
    <main className="flex flex-col gap-6 p-4 lg:p-6">
      <MembersManagementClient cabinetId={cabinetId} />
    </main>
  )
}
