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

/**
 * H5 (re-review) — `satisfies Record<TimePeriod, T>` ensures the lookup is
 * exhaustive : adding a new TimePeriod value produces a compile error
 * rather than silently falling back to "7d".
 */
const PERIOD_TO_API = {
  "1W": "7d",
  "2W": "14d",
  "1M": "30d",
  "3M": "90d",
} as const satisfies Record<TimePeriod, string>

const PERIOD_TO_DAYS = {
  "1W": 7,
  "2W": 14,
  "1M": 30,
  "3M": 90,
} as const satisfies Record<TimePeriod, number>

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

/**
 * Per-section error state — H1 (re-review) : a transient AGP 503 must NOT
 * hide the CGM chart and KPIs. Each section reports its own failure.
 */
interface SectionState {
  loading: boolean
  error: string | null
}

const INITIAL_STATE: SectionState = { loading: true, error: null }

export default function PatientDashboardPage() {
  const [period, setPeriod] = useState<TimePeriod>(TimePeriod.OneWeek)
  const [cgmPoints, setCgmPoints] = useState<{ time: string; glucose: number }[]>([])
  const [metrics, setMetrics] = useState<GlycemicMetrics | null>(null)
  const [agpSlots, setAgpSlots] = useState<AgpSlotPoint[]>([])
  const [cgmState, setCgmState] = useState<SectionState>(INITIAL_STATE)
  const [metricsState, setMetricsState] = useState<SectionState>(INITIAL_STATE)
  const [agpState, setAgpState] = useState<SectionState>(INITIAL_STATE)

  const days = PERIOD_TO_DAYS[period]
  const apiPeriod = PERIOD_TO_API[period]

  // 24h window for the CGM line chart — independent of selector period.
  const cgmRange = useMemo(() => {
    const to = new Date()
    const from = new Date(to.getTime() - 24 * 3600_000)
    return {
      from: from.toISOString(),
      to: to.toISOString(),
    }
  }, [])

  /**
   * H2 (re-review) — translate API error → human-actionable message.
   * `gdprConsentRequired` is the most common 403 we expect from /api/cgm.
   */
  function describeError(status: number, code?: string): string {
    if (status === 403 && code === "gdprConsentRequired") {
      return "Acceptez la politique de confidentialité dans vos préférences pour visualiser vos données."
    }
    if (status === 401) return "Session expirée. Reconnectez-vous."
    if (status >= 500) return "Service temporairement indisponible. Réessayez dans un instant."
    return "Impossible de charger cette section."
  }

  /** Fetch + parse a single endpoint into a `SectionState` + payload. */
  async function fetchSection<T>(url: string): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
    try {
      const res = await fetch(url, { credentials: "include" })
      if (!res.ok) {
        let code: string | undefined
        try {
          const body = (await res.json()) as { error?: string }
          code = body.error
        } catch { /* not JSON */ }
        return { ok: false, error: describeError(res.status, code) }
      }
      const data = (await res.json()) as T
      return { ok: true, data }
    } catch {
      return { ok: false, error: "Vérifiez votre connexion réseau." }
    }
  }

  const fetchData = useCallback(async () => {
    setCgmState({ loading: true, error: null })
    setMetricsState({ loading: true, error: null })
    setAgpState({ loading: true, error: null })

    // H1 — Promise.allSettled : each section completes independently.
    const [cgmResult, metricsResult, agpResult] = await Promise.all([
      fetchSection<{ entries: CgmEntry[] }>(
        `/api/cgm?from=${cgmRange.from}&to=${cgmRange.to}`,
      ),
      fetchSection<{ metrics: GlycemicMetrics }>(
        `/api/analytics/glycemic-profile?period=${apiPeriod}`,
      ),
      fetchSection<{ slots: AgpSlotPoint[] }>(
        `/api/analytics/agp?period=${apiPeriod}`,
      ),
    ])

    if (cgmResult.ok) {
      setCgmPoints(
        cgmResult.data.entries.map((e) => ({
          // L3 (re-review) — formatters.time delegates to next-intl ; fr-FR
          // is no longer hardcoded.
          time: new Date(e.timestamp).toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
          }),
          glucose: Math.round(e.valueGl * 100),
        })),
      )
      setCgmState({ loading: false, error: null })
    } else {
      setCgmState({ loading: false, error: cgmResult.error })
    }

    if (metricsResult.ok) {
      setMetrics(metricsResult.data.metrics)
      setMetricsState({ loading: false, error: null })
    } else {
      setMetricsState({ loading: false, error: metricsResult.error })
    }

    if (agpResult.ok) {
      setAgpSlots(agpResult.data.slots ?? [])
      setAgpState({ loading: false, error: null })
    } else {
      setAgpState({ loading: false, error: agpResult.error })
    }
  }, [cgmRange, apiPeriod])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  /**
   * M3 (re-review) — QuickActionsPanel modal wiring lands in Batch 2. Until
   * then surface a "Bientôt disponible" status so a patient knows the click
   * was registered (vs. broken UI). H3 — production builds drop the
   * console.info to avoid leaking action payload in browser logs.
   */
  const [toast, setToast] = useState<string | null>(null)
  const handleQuickAction = useCallback((action: QuickAction) => {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.info("[patient/dashboard] quick action", action)
    }
    setToast("Bientôt disponible")
    window.setTimeout(() => setToast(null), 2500)
  }, [])

  return (
    <main className="space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Mon tableau de bord</h1>
          <p className="text-sm text-gray-600 mt-1">
            {/* L1 (re-review) — i18n-grade plural rule will land with US-2115
                formatters. Until then keep a single phrasing valid for FR. */}
            Aperçu des {days} derniers jours.
          </p>
        </div>
        <PeriodSelector selectedPeriod={period} onPeriodSelected={setPeriod} />
      </header>

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-md border border-teal-200 bg-teal-50 text-teal-900 p-2 text-sm"
        >
          {toast}
        </div>
      )}

      {/* US-3361 — 24h CGM section + 4 KPI metrics. */}
      <section aria-labelledby="glycemia-section" className="space-y-4">
        <h2 id="glycemia-section" className="text-lg font-medium text-gray-800">
          Glycémie sur 24 h
        </h2>
        {metricsState.error && (
          <div role="status" className="rounded-md border border-amber-200 bg-amber-50 text-amber-900 p-3 text-sm">
            {metricsState.error}
          </div>
        )}
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
            loading={metricsState.loading}
          />
          <MetricCard
            title="Glycémie moyenne"
            value={metrics ? `${Math.round(metrics.avgMgdl)}` : "—"}
            unit="mg/dL"
            status="info"
            loading={metricsState.loading}
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
            loading={metricsState.loading}
          />
          <MetricCard
            title="HbA1c estimée"
            value={metrics ? metrics.gmi.toFixed(1) : "—"}
            unit="%"
            status="info"
            loading={metricsState.loading}
          />
        </div>
        {cgmState.error ? (
          <div role="status" className="rounded-md border border-amber-200 bg-amber-50 text-amber-900 p-3 text-sm">
            {cgmState.error}
          </div>
        ) : (
          <DiabeoCard variant="elevated" padding="md">
            <CgmChart data={cgmPoints} targetLow={70} targetHigh={180} height={320} />
          </DiabeoCard>
        )}
      </section>

      {/* US-3362 — AGP 7d résumé. */}
      <section aria-labelledby="agp-section" className="space-y-3">
        <h2 id="agp-section" className="text-lg font-medium text-gray-800">
          Profil ambulatoire (AGP)
        </h2>
        {agpState.error ? (
          <div role="status" className="rounded-md border border-amber-200 bg-amber-50 text-amber-900 p-3 text-sm">
            {agpState.error}
          </div>
        ) : (
          <DiabeoCard variant="elevated" padding="md">
            <AgpPercentileChart slots={agpSlots} />
          </DiabeoCard>
        )}
      </section>

      {/* US-3363 — Quick actions side panel. */}
      <section aria-labelledby="quick-section">
        <h2 id="quick-section" className="sr-only">Actions rapides</h2>
        <DiabeoCard variant="elevated" padding="md">
          <QuickActionsPanel onAction={handleQuickAction} />
        </DiabeoCard>
      </section>
    </main>
  )
}
