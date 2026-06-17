/**
 * US-2606 — « Paramètres du cabinet » (atterrissage Q2).
 * Résout le cabinet managé puis route vers `/cabinet/[id]/settings`.
 */
import { CabinetManagementLanding } from "@/components/diabeo/cabinet/CabinetManagementLanding"

export default function CabinetSettingsLandingPage() {
  return <CabinetManagementLanding section="settings" />
}
