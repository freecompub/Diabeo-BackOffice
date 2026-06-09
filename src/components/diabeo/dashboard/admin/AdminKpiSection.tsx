/**
 * US-2410 — KPI cabinet admin (4 metrics).
 * Polling 5min — données peu volatiles.
 */

"use client"

import { MetricCard } from "@/components/diabeo/MetricCard"
import { StaleBanner, STALE_MESSAGE_FR } from "@/components/diabeo/dashboard/medecin/StaleBanner"
import { usePollingFetch } from "@/hooks/usePollingFetch"
import type { AdminKpiCard } from "@/lib/services/admin-dashboard.service"

type ApiResponse = { items: AdminKpiCard[] }

const KPI_LABELS: Record<AdminKpiCard["code"], string> = {
  totalCabinets: "Cabinets",
  totalStaff: "Membres équipe",
  totalActivePatients: "Patients actifs (14j)",
  auditEventsLast7d: "Événements audit (7j)",
}

export function AdminKpiSection() {
  const { data, error, loading, isStale } = usePollingFetch<ApiResponse>(
    "/api/dashboard/admin/kpi",
    5 * 60_000,
  )
  const items = Array.isArray(data?.items) ? data!.items : []
  const hasError = error !== null && data === null
  const defaultCodes: AdminKpiCard["code"][] = [
    "totalCabinets", "totalStaff", "totalActivePatients", "auditEventsLast7d",
  ]
  return (
    <section aria-labelledby="admin-kpi-title">
      <h2 id="admin-kpi-title" className="mb-3 text-base font-semibold">
        Vue globale
      </h2>
      {hasError && (
        <p className="mb-2 text-sm text-glycemia-critical">
          Impossible de charger les KPI.
        </p>
      )}
      {isStale && <div className="mb-2"><StaleBanner message={STALE_MESSAGE_FR} /></div>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(loading && items.length === 0
          ? defaultCodes.map((code) => ({ code, value: 0, unit: null }))
          : items
        ).map((k) => (
          <MetricCard
            key={k.code}
            title={KPI_LABELS[k.code]}
            value={k.value}
            unit={k.unit ?? undefined}
            loading={loading && items.length === 0}
          />
        ))}
      </div>
    </section>
  )
}
