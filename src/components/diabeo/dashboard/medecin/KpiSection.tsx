/**
 * US-2404 — KPI cabinet 14j (médecin). 4 cards : patients actifs, TIR moyen,
 * urgences sem, propositions en attente. Polling 10min.
 */

"use client"

import { MetricCard } from "@/components/diabeo/MetricCard"
import { usePollingFetch } from "@/hooks/usePollingFetch"
import type { KpiCard } from "@/lib/services/doctor-dashboard.service"

type ApiResponse = { items: KpiCard[] }

const KPI_LABELS: Record<KpiCard["code"], string> = {
  activePatients: "Patients actifs (14j)",
  avgTir: "TIR moyen (14j)",
  weekUrgencies: "Urgences (7j)",
  pendingProposals: "Propositions en attente",
}

function mapTrendDirection(t: KpiCard["trend"]): "up" | "down" | "stable" | undefined {
  if (t === null) return undefined
  if (t === "flat") return "stable"
  return t
}

export function KpiSection() {
  const { data, error, loading } = usePollingFetch<ApiResponse>(
    "/api/dashboard/medecin/kpi",
    10 * 60_000,
  )
  const items = data?.items ?? []
  const hasError = error !== null && data === null

  return (
    <section aria-labelledby="kpi-section-title">
      <h2 id="kpi-section-title" className="mb-3 text-base font-semibold">
        KPI cabinet — 14 derniers jours
      </h2>
      {hasError && (
        <p className="mb-2 text-sm text-glycemia-critical">
          Impossible de charger les KPI.
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(loading && items.length === 0
          ? (["activePatients", "avgTir", "weekUrgencies", "pendingProposals"] as const).map(
              (code) => ({ code, value: 0, delta: null, trend: null, unit: null }),
            )
          : items
        ).map((k) => (
          <MetricCard
            key={k.code}
            title={KPI_LABELS[k.code]}
            value={k.value}
            unit={k.unit ?? undefined}
            loading={loading && items.length === 0}
            trend={
              k.delta !== null && k.trend !== null && k.trend !== "flat"
                ? {
                    direction: mapTrendDirection(k.trend)!,
                    value: `${k.delta > 0 ? "+" : ""}${k.delta}${k.unit ?? ""}`,
                  }
                : undefined
            }
          />
        ))}
      </div>
    </section>
  )
}
