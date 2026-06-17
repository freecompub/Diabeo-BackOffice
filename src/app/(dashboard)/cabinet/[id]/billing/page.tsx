/**
 * US-2606 — « Facturation » d'un cabinet (bloc gestion Q2) — Server Component.
 *
 * Garde Q2 sur CE service (ADMIN bypass) ; lecture seule du registre de
 * facturation. Aucune donnée de santé (PII admin / financier uniquement).
 *
 * ⚠️ V1 — divergence de modèle d'autorisation (à réconcilier, cf. follow-up Q2) :
 * la **page** est gardée sur Q2 (`HealthcareMembership.canManage`), mais la
 * **lecture** des factures (`/api/billing/invoices` → `invoiceService.listByCabinet`)
 * autorise sur `HealthcareMember` (roster praticien, table distincte). Un délégué
 * Q2 sans ligne `HealthcareMember` voit la page puis reçoit 403 sur le fetch.
 * Pas de fuite (la garde la plus stricte gagne, l'API reste la frontière), mais
 * révoquer Q2 ne révoque pas l'accès billing → réconciliation = même ticket que
 * la mutation settings (cf. `cabinet/[id]/settings/page.tsx`).
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
