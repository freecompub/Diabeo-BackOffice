/**
 * US-3356 — Patient self-service dashboard (page principale).
 *
 * Sections in this page:
 *  - US-3361 Section glycémie 24h détaillée (CgmChart + KPI MetricCards)
 *  - US-3362 Section AGP 7 jours résumé (AgpPercentileChart)
 *  - US-3363 Panel actions rapides (QuickActionsPanel)
 *
 * Auth: route protected by middleware + `(patient)/layout.tsx` which
 *       redirects non-VIEWER users back to /dashboard. The endpoints
 *       called below (/api/cgm, /api/analytics/*) resolve the patient
 *       from the VIEWER's own session via `resolvePatientIdFromQuery`.
 */

"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { CgmChart } from "@/components/diabeo/CgmChart"
import {
  AgpPercentileChart,
  type AgpSlotPoint,
} from "@/components/diabeo/AgpPercentileChart"
import { MetricCard } from "@/components/diabeo/MetricCard"
import {
  PeriodSelector,
  TimePeriod,
} from "@/components/diabeo/PeriodSelector"
import { QuickActionsPanel, type QuickAction } from "@/components/diabeo/QuickActionsPanel"
import { DiabeoCard } from "@/components/diabeo/DiabeoCard"

/** UI-level period (selector) → API `period` string. */
function periodToApiString(p: TimePeriod): string {
  switch (p) {
    case TimePeriod.OneWeek: return "7d"
    case TimePeriod.TwoWeeks: return "14d"
    case TimePeriod.OneMonth: return "30d"
    case TimePeriod.ThreeMonths: return "90d"
    default: return "7d"
  }
}

function periodToDays(p: TimePeriod): number {
  switch (p) {
    case TimePeriod.OneWeek: return 7
    case TimePeriod.TwoWeeks: return 14
    case TimePeriod.OneMonth: return 30
    case TimePeriod.ThreeMonths: return 90
    default: return 7
  }
}

interface GlycemicMetrics {
  tir: number       // % time in range
  gmi: number       // glucose management indicator (HbA1c equivalent)
  cv: number        // coefficient of variation %
  avgMgdl: number   // average glucose (mg/dL)
}

interface CgmEntry {
  timestamp: string
  valueGl: number
}

export default function PatientDashboardPage() {
  const [period, setPeriod] = useState<TimePeriod>(TimePeriod.OneWeek)
  const [cgmPoints, setCgmPoints] = useState<{ time: string; glucose: number }[]>([])
  const [metrics, setMetrics] = useState<GlycemicMetrics | null>(null)
  const [agpSlots, setAgpSlots] = useState<AgpSlotPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const days = periodToDays(period)
  const apiPeriod = periodToApiString(period)

  // 24h window for the CGM line chart — independent of selector period.
  const cgmRange = useMemo(() => {
    const to = new Date()
    const from = new Date(to.getTime() - 24 * 3600_000)
    return {
      from: from.toISOString(),
      to: to.toISOString(),
    }
  }, [])

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [cgmRes, metricsRes, agpRes] = await Promise.all([
        fetch(`/api/cgm?from=${cgmRange.from}&to=${cgmRange.to}`, { credentials: "include" }),
        fetch(`/api/analytics/glycemic-profile?period=${apiPeriod}`, { credentials: "include" }),
        fetch(`/api/analytics/agp?period=${apiPeriod}`, { credentials: "include" }),
      ])
      if (!cgmRes.ok || !metricsRes.ok || !agpRes.ok) {
        throw new Error("fetchFailed")
      }
      const cgmData = (await cgmRes.json()) as { entries: CgmEntry[] }
      const metricsData = (await metricsRes.json()) as {
        metrics: GlycemicMetrics
      }
      const agpData = (await agpRes.json()) as { slots: AgpSlotPoint[] }

      setCgmPoints(
        cgmData.entries.map((e) => ({
          time: new Date(e.timestamp).toLocaleTimeString("fr-FR", {
            hour: "2-digit",
            minute: "2-digit",
          }),
          // Convert g/L → mg/dL for the chart (CgmChart expects mg/dL).
          glucose: Math.round(e.valueGl * 100),
        })),
      )
      setMetrics(metricsData.metrics)
      setAgpSlots(agpData.slots ?? [])
    } catch {
      setError("Impossible de charger les données. Vérifiez votre connexion.")
    } finally {
      setLoading(false)
    }
  }, [cgmRange, apiPeriod])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  const handleQuickAction = useCallback((action: QuickAction) => {
    // TODO(Batch 2) — wire to modal infrastructure when patient modals land.
    // For now log to console so QA can validate clicks.
    // eslint-disable-next-line no-console
    console.info("[patient/dashboard] quick action", action)
  }, [])

  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Mon tableau de bord</h1>
          <p className="text-sm text-gray-600 mt-1">
            Aperçu de vos {days} dernier{days > 1 ? "s" : ""} jour{days > 1 ? "s" : ""}.
          </p>
        </div>
        <PeriodSelector selectedPeriod={period} onPeriodSelected={setPeriod} />
      </header>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 text-red-800 p-3 text-sm"
        >
          {error}
        </div>
      )}

      {/* US-3361 — 24h CGM section + 4 KPI metrics. */}
      <section aria-labelledby="glycemia-section" className="space-y-4">
        <h2 id="glycemia-section" className="text-lg font-medium text-gray-800">
          Glycémie sur 24 h
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard
            title="Temps dans la cible"
            value={metrics ? `${Math.round(metrics.tir)}` : "—"}
            unit="%"
            status={
              metrics && metrics.tir >= 70 ? "normal"
              : metrics && metrics.tir >= 50 ? "warning"
              : "critical"
            }
            loading={loading}
          />
          <MetricCard
            title="Glycémie moyenne"
            value={metrics ? `${Math.round(metrics.avgMgdl)}` : "—"}
            unit="mg/dL"
            status="info"
            loading={loading}
          />
          <MetricCard
            title="Variabilité (CV)"
            value={metrics ? `${metrics.cv.toFixed(1)}` : "—"}
            unit="%"
            status={
              metrics && metrics.cv < 36 ? "normal"
              : metrics && metrics.cv < 45 ? "warning"
              : "critical"
            }
            loading={loading}
          />
          <MetricCard
            title="HbA1c estimée"
            value={metrics ? metrics.gmi.toFixed(1) : "—"}
            unit="%"
            status="info"
            loading={loading}
          />
        </div>
        <DiabeoCard variant="elevated" padding="md">
          <CgmChart data={cgmPoints} targetLow={70} targetHigh={180} height={320} />
        </DiabeoCard>
      </section>

      {/* US-3362 — AGP 7d résumé. */}
      <section aria-labelledby="agp-section" className="space-y-3">
        <h2 id="agp-section" className="text-lg font-medium text-gray-800">
          Profil ambulatoire (AGP)
        </h2>
        <DiabeoCard variant="elevated" padding="md">
          <AgpPercentileChart slots={agpSlots} />
        </DiabeoCard>
      </section>

      {/* US-3363 — Quick actions side panel. */}
      <section aria-labelledby="quick-section">
        <h2 id="quick-section" className="sr-only">Actions rapides</h2>
        <DiabeoCard variant="elevated" padding="md">
          <QuickActionsPanel onAction={handleQuickAction} />
        </DiabeoCard>
      </section>
    </div>
  )
}
