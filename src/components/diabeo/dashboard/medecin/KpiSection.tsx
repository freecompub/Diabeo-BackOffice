/**
 * US-2404 — KPI cabinet 14j (médecin). 4 cards : patients actifs, TIR moyen,
 * urgences sem, propositions en attente. Polling 10min.
 */

"use client"

import { useTranslations } from "next-intl"
import { MetricCard } from "@/components/diabeo/MetricCard"
import { StaleBanner } from "@/components/diabeo/dashboard/medecin/StaleBanner"
import { usePollingFetch } from "@/hooks/usePollingFetch"
import type { KpiCard } from "@/lib/services/doctor-dashboard.service"

type ApiResponse = { items: KpiCard[] }

function mapTrendDirection(trend: KpiCard["trend"]): "up" | "down" | "stable" | undefined {
  if (trend === null) return undefined
  if (trend === "flat") return "stable"
  return trend
}

export function KpiSection() {
  const t = useTranslations("dashboard.medecin")
  const { data, error, loading, isStale } = usePollingFetch<ApiResponse>(
    "/api/dashboard/medecin/kpi",
    10 * 60_000,
  )
  // code-review H5 — defensive against malformed response.
  const items = Array.isArray(data?.items) ? data!.items : []
  const hasError = error !== null && data === null

  return (
    <section aria-labelledby="kpi-section-title">
      <h2 id="kpi-section-title" className="mb-3 font-display text-base font-semibold">
        {t("kpi.title")}
      </h2>
      {hasError && (
        <p className="mb-2 text-sm text-glycemia-critical">{t("kpi.error")}</p>
      )}
      {isStale && (
        <div className="mb-2">
          <StaleBanner message={t("stale")} />
        </div>
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
            title={t(`kpi.${k.code}`)}
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
