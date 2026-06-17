/**
 * US-2606 — « Paiements » d'un cabinet (bloc gestion Q2) — Server Component.
 *
 * Garde Q2 sur CE service (ADMIN bypass) ; lecture seule des factures encaissées.
 * Données financières ≠ données de santé : régime et écran distincts.
 */
import { requireCabinetManagementAccess } from "@/lib/cabinet-access"
import { CabinetInvoicesClient } from "@/components/diabeo/cabinet/CabinetInvoicesClient"

export default async function CabinetPaymentsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { cabinetId } = await requireCabinetManagementAccess(id)

  return (
    <main className="flex flex-col gap-6 p-4 lg:p-6">
      <CabinetInvoicesClient cabinetId={cabinetId} mode="payments" />
    </main>
  )
}
