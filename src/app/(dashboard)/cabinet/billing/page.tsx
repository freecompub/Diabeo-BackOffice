/**
 * US-2606 — « Facturation » (atterrissage Q2).
 * Résout le cabinet managé puis route vers `/cabinet/[id]/billing`.
 */
import { CabinetManagementLanding } from "@/components/diabeo/cabinet/CabinetManagementLanding"

export default function CabinetBillingLandingPage() {
  return <CabinetManagementLanding section="billing" />
}
