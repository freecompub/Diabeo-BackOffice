/**
 * US-2406 — KPI ma journée (infirmier). 4 metrics : RDV à préparer,
 * événements à valider, urgences observées, propositions à connaître.
 * Polling 60s.
 */

"use client"

import { MetricCard } from "@/components/diabeo/MetricCard"
import { StaleBanner, STALE_MESSAGE_FR } from "@/components/diabeo/dashboard/medecin/StaleBanner"
import { usePollingFetch } from "@/hooks/usePollingFetch"
import type { NurseKpiCard } from "@/lib/services/nurse-dashboard.service"

type ApiResponse = { items: NurseKpiCard[] }

const KPI_LABELS: Record<NurseKpiCard["code"], string> = {
  rdvToPrepare: "RDV à préparer",
  eventsToValidate: "Événements à valider",
  openUrgencies: "Urgences observées",
  proposalsPending: "Propositions à connaître",
}

export function NurseKpiSection() {
  const { data, error, loading, isStale } = usePollingFetch<ApiResponse>(
    "/api/dashboard/infirmier/kpi",
    60_000,
  )
  const items = Array.isArray(data?.items) ? data!.items : []
  const hasError = error !== null && data === null
  const defaultCodes: NurseKpiCard["code"][] = [
    "rdvToPrepare", "eventsToValidate", "openUrgencies", "proposalsPending",
  ]
  return (
    <section aria-labelledby="nurse-kpi-title">
      <h2 id="nurse-kpi-title" className="mb-3 text-base font-semibold">
        Ma journée
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
