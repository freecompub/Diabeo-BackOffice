/**
 * US-2606 — « Facturation » d'un cabinet (bloc gestion Q2) — Server Component.
 *
 * Garde Q2 sur CE service (ADMIN bypass) ; lecture seule du registre de
 * facturation. Aucune donnée de santé (PII admin / financier uniquement).
 */
import { requireCabinetManagementAccess } from "@/lib/cabinet-access"
import { CabinetInvoicesClient } from "@/components/diabeo/cabinet/CabinetInvoicesClient"

export default async function CabinetBillingPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { cabinetId } = await requireCabinetManagementAccess(id)

  return (
    <main className="flex flex-col gap-6 p-4 lg:p-6">
      <CabinetInvoicesClient cabinetId={cabinetId} mode="billing" />
    </main>
  )
}
