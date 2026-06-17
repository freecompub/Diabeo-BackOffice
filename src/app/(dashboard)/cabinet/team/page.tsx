/**
 * US-2606 — « Gestion de l'équipe & droits » (atterrissage Q2).
 * Résout le cabinet managé puis route vers `/cabinet/[id]/members`.
 */
import { CabinetManagementLanding } from "@/components/diabeo/cabinet/CabinetManagementLanding"

export default function CabinetTeamLandingPage() {
  return <CabinetManagementLanding section="team" />
}
