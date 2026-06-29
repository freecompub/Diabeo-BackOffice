/**
 * US-2400 / US-2602 — « Ma journée » (dashboard médecin, page conteneur).
 *
 * Vue jour du médecin — agencement « Home v3 » (triage-first, cf.
 * docs/mockups/home-roles-v3.html §médecin). Layout responsive (1 col mobile,
 * 2 col lg+) :
 *   1. Alertes glycémiques / urgences (FULL-WIDTH, en tête — carte de triage)
 *   2. Grille 2×2 : Propositions · Rendez-vous / Relances · Messages
 *   3. Patients à suivre (full-width)
 *   4. Indicateurs clés (KPI) du cabinet
 *
 * Le mockup ne montre ni KPI ni « Patients à suivre » pour le médecin ; on les
 * conserve sous la grille (décision produit : features livrées US-2403/US-2404
 * non retirées) tout en adoptant l'ordre de triage du mockup pour le haut.
 *
 * Server-side guard : redirect non-DOCTOR/NURSE/ADMIN to login. The
 * (dashboard)/layout.tsx already redirects VIEWER → /patient/dashboard.
 */

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { getTranslations } from "next-intl/server"
import type { Role } from "@prisma/client"
import { triageSummaryQuery } from "@/lib/services/doctor-dashboard.service"
import { DashboardGreeting } from "@/components/diabeo/dashboard/DashboardGreeting"
import { EmergencyCard } from "@/components/diabeo/dashboard/medecin/EmergencyCard"
import { AppointmentCard } from "@/components/diabeo/dashboard/medecin/AppointmentCard"
import { PatientsAtRiskCard } from "@/components/diabeo/dashboard/medecin/PatientsAtRiskCard"
import { KpiSection } from "@/components/diabeo/dashboard/medecin/KpiSection"
// US-2602 (Ma journée) incr. 1 — Relances en attente. Réutilise la query
// infirmier (`nurseRecallQuery`, scopée au portefeuille de l'appelant) + la
// route `/api/dashboard/infirmier/recall-list` (minRole NURSE → DOCTOR éligible).
import { RecallListCard } from "@/components/diabeo/dashboard/infirmier/RecallListCard"
// US-2602 (Ma journée) incr. 2 — Propositions d'ajustement en attente.
import { PendingProposalsCard } from "@/components/diabeo/dashboard/medecin/PendingProposalsCard"
// US-2602 (Ma journée) incr. 3 — Messages non lus (liste).
import { UnreadMessagesCard } from "@/components/diabeo/dashboard/medecin/UnreadMessagesCard"

const ALLOWED_ROLES = new Set(["DOCTOR", "NURSE", "ADMIN"])

export default async function MedecinDashboardPage() {
  const headersList = await headers()
  const role = headersList.get("x-user-role")
  if (!role || !ALLOWED_ROLES.has(role)) redirect("/login")

  const t = await getTranslations("dashboard.medecin")

  // Compteurs de triage du sous-titre (mockup Home v3). Count-only, scopé au
  // portefeuille de l'appelant ; n'audite qu'une ligne récapitulative.
  const userId = Number(headersList.get("x-user-id"))
  const triage =
    Number.isInteger(userId) && userId > 0
      ? await triageSummaryQuery.forCaller(userId, role as Role, userId)
      : { patientsToTriage: 0, priorityAlerts: 0 }
  const subtitleExtra =
    triage.patientsToTriage > 0 || triage.priorityAlerts > 0 ? (
      <>
        <span className="font-semibold text-role-text">
          {t("triage.patientsToTriage", { count: triage.patientsToTriage })}
        </span>
        {" · "}
        {t("triage.priorityAlerts", { count: triage.priorityAlerts })}
      </>
    ) : undefined

  return (
    <main className="flex flex-col gap-6 p-4 lg:p-6">
      <DashboardGreeting
        title={t("pageTitle")}
        greeting={(name) => t("greeting", { name })}
        subtitleExtra={subtitleExtra}
      />
      {/* Carte de triage en tête, pleine largeur (mockup §médecin). */}
      <EmergencyCard />
      {/* Grille 2×2 : Propositions · Rendez-vous / Relances · Messages. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PendingProposalsCard />
        <AppointmentCard />
        <RecallListCard />
        <UnreadMessagesCard />
      </div>
      <PatientsAtRiskCard />
      <KpiSection />
    </main>
  )
}
