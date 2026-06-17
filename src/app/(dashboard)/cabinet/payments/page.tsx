/**
 * US-2606 — « Paiements » (atterrissage Q2).
 * Résout le cabinet managé puis route vers `/cabinet/[id]/payments`.
 */
import { CabinetManagementLanding } from "@/components/diabeo/cabinet/CabinetManagementLanding"

export default function CabinetPaymentsLandingPage() {
  return <CabinetManagementLanding section="payments" />
}
