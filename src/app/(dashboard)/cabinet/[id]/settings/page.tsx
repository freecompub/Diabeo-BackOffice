/**
 * US-2606 — « Paramètres du cabinet » (bloc gestion Q2) — Server Component.
 *
 * Garde Q2 sur CE service (ADMIN bypass) à l'affichage. Réutilise l'éditeur
 * `CabinetDetailClient` (settings + SMS), avec un lien retour vers l'espace
 * gestion (`/cabinet/team`) au lieu de l'espace plateforme ADMIN.
 *
 * ⚠️ V1 — les **mutations** de settings restent gated « manager légal
 * (`HealthcareService.managerId`) ou ADMIN » côté `cabinet-settings.service`
 * (non encore réconcilié sur Q2). Un Q2 délégué non-manager voit la page mais
 * l'enregistrement renverra 403 → réconciliation Q2 = follow-up documenté.
 */
import { getTranslations } from "next-intl/server"
import { requireCabinetManagementAccess } from "@/lib/cabinet-access"
import { CabinetDetailClient } from "@/components/diabeo/admin/CabinetDetailClient"

export default async function CabinetSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { cabinetId } = await requireCabinetManagementAccess(id)
  const t = await getTranslations("cabinetMgmt")

  return (
    <main className="flex flex-col gap-6 p-4 lg:p-6">
      <CabinetDetailClient
        cabinetId={cabinetId}
        backHref="/cabinet/team"
        backLabel={t("backToManagement")}
      />
    </main>
  )
}
