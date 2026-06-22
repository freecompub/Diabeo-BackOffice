/**
 * US-2410 — Dashboard administrateur (page conteneur).
 *
 * Layout : KPI top full-width, BillingCard + ComplianceCard 2-col lg+.
 * Server-side guard : ADMIN-only ; non-ADMIN redirigé `/login`.
 */

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { getTranslations } from "next-intl/server"
import Link from "next/link"
import { ChevronRight, ShieldCheck } from "lucide-react"
import { DashboardGreeting } from "@/components/diabeo/dashboard/DashboardGreeting"
import { AdminKpiSection } from "@/components/diabeo/dashboard/admin/AdminKpiSection"
import { BillingCard } from "@/components/diabeo/dashboard/admin/BillingCard"
import { ComplianceCard } from "@/components/diabeo/dashboard/admin/ComplianceCard"

export default async function AdminDashboardPage() {
  const headersList = await headers()
  const role = headersList.get("x-user-role")
  // UX guard — server-side fast bounce ; the actual authorization happens
  // inside the API routes (`auditedRequireRole(req, "ADMIN", …)`). Non-ADMIN
  // bounce goes to `/` so the root role-router sends them to their proper
  // dashboard (DOCTOR → /medecin, NURSE → /infirmier, VIEWER → /patient/…).
  // code-review L3 (re-review) — previously redirected to `/login` which
  //   was misleading (caller IS logged in, just role-mismatched).
  if (role !== "ADMIN") redirect("/")

  const t = await getTranslations()

  return (
    <main className="flex flex-col gap-6 p-4 lg:p-6">
      <DashboardGreeting
        title={t("adminDashboard.pageTitle")}
        greeting={(name) => t("adminDashboard.greeting", { name })}
      />
      {/* US-2410 — périmètre de l'ÉCRAN admin : ce tableau de bord ne présente
          que des agrégats gouvernance/facturation/audit (aucun PHI affiché —
          cf. admin-dashboard.service). NB : claim volontairement scopé à
          l'écran, pas au rôle ADMIN (qui conserve un bypass PHI V1 connu,
          access-control.ts). Ne PAS réintroduire une affirmation rôle-large. */}
      <div
        role="note"
        className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
      >
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        <p>{t("adminDashboard.scopeNotice")}</p>
      </div>
      <AdminKpiSection />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BillingCard />
        <ComplianceCard />
      </div>
      {/* US-2613 — entrée vers l'espace administration plateforme (SYSTEM_ADMIN). */}
      <Link
        href="/admin/platform"
        className="flex min-h-11 items-center gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <ShieldCheck className="size-6 shrink-0 text-primary" aria-hidden="true" />
        <div className="flex-1">
          <span className="font-medium">{t("platformAdmin.hubTitle")}</span>
          <p className="mt-1 text-sm text-muted-foreground">{t("platformAdmin.hubSubtitle")}</p>
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden="true" />
      </Link>
    </main>
  )
}
