/**
 * US-2410 — KPI cabinet admin (4 metrics).
 * Polling 5min — données peu volatiles.
 */

"use client"

import { useTranslations } from "next-intl"
import { MetricCard } from "@/components/diabeo/MetricCard"
import { StaleBanner } from "@/components/diabeo/dashboard/medecin/StaleBanner"
import { usePollingFetch } from "@/hooks/usePollingFetch"
import type { AdminKpiCard } from "@/lib/services/admin-dashboard.service"

type ApiResponse = { items: AdminKpiCard[] }

export function AdminKpiSection() {
  const t = useTranslations("adminDashboard")
  const { data, error, loading, isStale } = usePollingFetch<ApiResponse>(
    "/api/dashboard/admin/kpi",
    5 * 60_000,
  )
  const items = Array.isArray(data?.items) ? data!.items : []
  const hasError = error !== null && data === null
  const defaultCodes: AdminKpiCard["code"][] = [
    "totalCabinets", "totalStaff", "totalActivePatients", "auditEventsLast7d",
  ]
  const KPI_LABELS: Record<AdminKpiCard["code"], string> = {
    totalCabinets: t("kpiCabinets"),
    totalStaff: t("kpiMembers"),
    totalActivePatients: t("kpiActivePatients"),
    auditEventsLast7d: t("kpiAuditEvents"),
  }
  return (
    <section aria-labelledby="admin-kpi-title">
      <h2 id="admin-kpi-title" className="mb-3 text-base font-semibold">
        {t("globalViewTitle")}
      </h2>
      {hasError && (
        <p className="mb-2 text-sm text-glycemia-critical">
          {t("kpiLoadError")}
        </p>
      )}
      {isStale && <div className="mb-2"><StaleBanner message={t("stale")} /></div>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(loading && items.length === 0
          ? defaultCodes.map((code) => ({ code, value: 0, unit: null }))
          : items
        ).map((k) => (
          <MetricCard
            key={k.code}
            // Fallback `k.code` si l'API renvoie un code inattendu (ex: ajout
            // backend non répercuté en front) — évite d'afficher "undefined"
            // en titre et dans l'aria-label du screen reader.
            title={KPI_LABELS[k.code] ?? k.code}
            value={k.value}
            unit={k.unit ?? undefined}
            loading={loading && items.length === 0}
          />
        ))}
      </div>
    </section>
  )
}
