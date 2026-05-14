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

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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
 * H5 — exhaustive lookup. Adding a new TimePeriod yields a compile error.
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

// Types match the real API responses (C2/C3/C4 fix). These shapes mirror
// `glycemia.service.getCgmEntries` and `analytics.service.glycemicProfile/agp`.
interface CgmEntry {
  timestamp: string
  valueGl: number
}
interface TirResult {
  severeHypo: number
  hypo: number
  inRange: number
  elevated: number
  hyper: number
}
interface GlycemicProfileResponse {
  metrics: {
    averageGlucoseGl: number
    averageGlucoseMgdl: number
    gmi: number
    coefficientOfVariation: number
    quality: string
  }
  tir: TirResult
}

/** Per-section error state — independent failure modes per US-3361/3362/3363. */
interface SectionState {
  loading: boolean
  error: string | null
}

const INITIAL_STATE: SectionState = { loading: true, error: null }

/** Known API error codes — narrow to catch typos at compile time (M6). */
type KnownApiErrorCode = "gdprConsentRequired" | "invalidPatientId" | "notFound"

function describeError(status: number, code?: KnownApiErrorCode | string): string {
  if (status === 403 && code === "gdprConsentRequired") {
    return "Acceptez la politique de confidentialité dans vos préférences pour visualiser vos données."
  }
  if (status === 403) {
    return "Accès refusé. Reconnectez-vous ou contactez votre médecin."
  }
  if (status === 401) return "Session expirée. Reconnectez-vous."
  if (status >= 500) return "Service temporairement indisponible. Réessayez dans un instant."
  return "Impossible de charger cette section."
}

/** Fetch + parse a single endpoint into a discriminated union. Module-scope
 *  so it is testable without rendering the page (M3). */
async function fetchSection<T>(
  url: string,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
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

export default function PatientDashboardPage() {
  const [period, setPeriod] = useState<TimePeriod>(TimePeriod.OneWeek)
  const [cgmPoints, setCgmPoints] = useState<{ time: string; glucose: number }[]>([])
  const [profile, setProfile] = useState<GlycemicProfileResponse | null>(null)
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

  const fetchData = useCallback(async () => {
    setCgmState({ loading: true, error: null })
    setMetricsState({ loading: true, error: null })
    setAgpState({ loading: true, error: null })

    // H2 (re-review) — `allSettled` so an AbortError on one fetch can't
    // poison the other two. Each `fetchSection` also catches its own
    // network errors, so we only branch on `status === "fulfilled"`.
    const results = await Promise.allSettled([
      fetchSection<CgmEntry[]>(`/api/cgm?from=${cgmRange.from}&to=${cgmRange.to}`),
      fetchSection<GlycemicProfileResponse>(`/api/analytics/glycemic-profile?period=${apiPeriod}`),
      fetchSection<AgpSlotPoint[]>(`/api/analytics/agp?period=${apiPeriod}`),
    ])

    const [cgmSettled, metricsSettled, agpSettled] = results

    if (cgmSettled.status === "fulfilled" && cgmSettled.value.ok) {
      // C2 fix — /api/cgm returns CgmEntry[] directly (not { entries: ... }).
      setCgmPoints(
        cgmSettled.value.data.map((e) => ({
          // L3 — undefined locale = browser default (delegates to next-intl in Batch 2).
          time: new Date(e.timestamp).toLocaleTimeString(undefined, {
            hour: "2-digit", minute: "2-digit",
          }),
          glucose: Math.round(e.valueGl * 100),
        })),
      )
      setCgmState({ loading: false, error: null })
    } else {
      const err = cgmSettled.status === "fulfilled" && !cgmSettled.value.ok
        ? cgmSettled.value.error : "Vérifiez votre connexion réseau."
      setCgmState({ loading: false, error: err })
    }

    if (metricsSettled.status === "fulfilled" && metricsSettled.value.ok) {
      // C3 fix — service returns { metrics: { averageGlucoseMgdl, ... }, tir: TirResult }.
      setProfile(metricsSettled.value.data)
      setMetricsState({ loading: false, error: null })
    } else {
      const err = metricsSettled.status === "fulfilled" && !metricsSettled.value.ok
        ? metricsSettled.value.error : "Vérifiez votre connexion réseau."
      setMetricsState({ loading: false, error: err })
    }

    if (agpSettled.status === "fulfilled" && agpSettled.value.ok) {
      // C4 fix — /api/analytics/agp returns AgpSlot[] directly.
      setAgpSlots(agpSettled.value.data ?? [])
      setAgpState({ loading: false, error: null })
    } else {
      const err = agpSettled.status === "fulfilled" && !agpSettled.value.ok
        ? agpSettled.value.error : "Vérifiez votre connexion réseau."
      setAgpState({ loading: false, error: err })
    }
  }, [cgmRange, apiPeriod])

  useEffect(() => {
    let cancelled = false
    // Wrapping in a microtask ensures the setState calls inside fetchData
    // run after the current render commit, satisfying the
    // no-sync-state-in-effect lint rule.
    queueMicrotask(() => {
      if (!cancelled) void fetchData()
    })
    return () => { cancelled = true }
  }, [fetchData])

  /**
   * H3 (re-review) — toast lifecycle via `useRef` so a rapid second click
   * clears the previous timer (no premature dismiss) and unmount cleans up.
   */
  const [toast, setToast] = useState<string | null>(null)
  const toastTimerRef = useRef<number | null>(null)
  const handleQuickAction = useCallback((action: QuickAction) => {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.info("[patient/dashboard] quick action", action)
    }
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current)
    }
    setToast("Bientôt disponible")
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null)
      toastTimerRef.current = null
    }, 2500)
  }, [])
  useEffect(() => () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
  }, [])

  // C3 — TIR percentage is the "inRange" zone from TirResult.
  const tirPct = profile?.tir.inRange

  /**
   * C1 (re-review) — DO NOT wrap in <main>. `NavigationShell` already
   * provides the page-level <main> landmark — adding another here would
   * create double-main (WCAG 1.3.1 violation).
   */
  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Mon tableau de bord</h1>
          <p className="text-sm text-gray-600 mt-1">
            Aperçu des {days} derniers jours.
          </p>
        </div>
        <PeriodSelector selectedPeriod={period} onPeriodSelected={setPeriod} />
      </header>

      {toast && (
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
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
          // C5 — actionable error → role="alert" (assertive) per WCAG 4.1.3.
          <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 text-amber-900 p-3 text-sm">
            {metricsState.error}
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard
            title="Temps dans la cible"
            value={tirPct !== undefined ? `${Math.round(tirPct)}` : "—"}
            unit="%"
            status={
              tirPct !== undefined && tirPct >= 70 ? "normal"
              : tirPct !== undefined && tirPct >= 50 ? "warning"
              : "critical"
            }
            loading={metricsState.loading}
          />
          <MetricCard
            title="Glycémie moyenne"
            value={profile ? `${Math.round(profile.metrics.averageGlucoseMgdl)}` : "—"}
            unit="mg/dL"
            status="info"
            loading={metricsState.loading}
          />
          <MetricCard
            title="Variabilité (CV)"
            value={profile ? `${profile.metrics.coefficientOfVariation.toFixed(1)}` : "—"}
            unit="%"
            status={
              profile && profile.metrics.coefficientOfVariation < 36 ? "normal"
              : profile && profile.metrics.coefficientOfVariation < 45 ? "warning"
              : "critical"
            }
            loading={metricsState.loading}
          />
          <MetricCard
            title="HbA1c estimée"
            value={profile ? profile.metrics.gmi.toFixed(1) : "—"}
            unit="%"
            status="info"
            loading={metricsState.loading}
          />
        </div>
        {cgmState.error ? (
          <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 text-amber-900 p-3 text-sm">
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
          <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 text-amber-900 p-3 text-sm">
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
    </div>
  )
}
