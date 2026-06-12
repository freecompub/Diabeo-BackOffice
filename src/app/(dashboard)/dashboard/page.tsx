"use client"

/**
 * Dashboard — Glycemia Overview (US-WEB-201)
 *
 * Patient-facing glycemia dashboard displaying:
 *   - DataSummaryGrid: 6 clinical metrics (avg glucose, HbA1c, TIR, CV, SD, hypo events)
 *   - GlycemiaEvolutionChart: CGM timeline with insulin overlays and event markers
 *   - PeriodSelector: time window switch (1W, 2W, 1M, 3M)
 *   - "Nouvel evenement" action — desktop header button + mobile FAB
 *
 * Data fetching:
 *   - All fetches use credentials: "include" + X-Requested-With header (CSRF-safe)
 *   - SWR-style polling every 5 minutes via useEffect interval
 *   - Period change triggers immediate re-fetch
 *
 * States:
 *   - loading  — skeleton via DataSummaryGrid loading prop + chart placeholder
 *   - error    — DiabeoEmptyState variant="error" with retry callback
 *   - empty    — DiabeoEmptyState variant="noData" when no CGM readings
 *   - success  — full chart + metrics grid
 *
 * Accessibility:
 *   - Live region announces refresh state to screen readers
 *   - "Nouvel evenement" button has aria-label
 *   - FAB only visible on small screens (hidden on md+) to avoid duplicate controls
 *
 * i18n: uses "dashboard" namespace (fr/en/ar)
 * Analytics: tracks page_view, period_changed, new_event_opened, data_refreshed
 */

import { useState, useEffect, useCallback, useRef } from "react"
import { useTranslations, useLocale } from "next-intl"
import { useRouter } from "next/navigation"
import { Plus, RefreshCw } from "lucide-react"

import { DataSummaryGrid } from "@/components/diabeo/widgets/DataSummaryGrid"
import { GlycemiaEvolutionChart } from "@/components/diabeo/charts/GlycemiaEvolutionChart"
import { DiabeoEmptyState } from "@/components/diabeo/DiabeoEmptyState"
import { DiabeoButton } from "@/components/diabeo/DiabeoButton"
import { DiabeoFAB } from "@/components/diabeo/DiabeoFAB"
import { PeriodSelector, TimePeriod } from "@/components/diabeo/PeriodSelector"
import type { WidgetData } from "@/components/diabeo/widgets/types"
import type { GlucoseDataPoint } from "@/components/diabeo/charts/types"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Auto-refresh interval in ms (5 minutes) */
const REFRESH_INTERVAL_MS = 5 * 60 * 1000

/** Map period selector values to API query param format */
const PERIOD_TO_API: Record<TimePeriod, string> = {
  "1W": "7d",
  "2W": "14d",
  "1M": "30d",
  "3M": "90d",
}

// ---------------------------------------------------------------------------
// API types (raw responses)
// ---------------------------------------------------------------------------

interface GlycemicProfileApiResponse {
  averageGlucose?: number
  averageGlucoseUnit?: string
  hba1c?: number
  cv?: number
  standardDeviation?: number
  standardDeviationUnit?: string
}

interface TimeInRangeApiResponse {
  veryLow?: number
  low?: number
  inRange?: number
  high?: number
  veryHigh?: number
  readingCount?: number
}

interface HypoglycemiaApiResponse {
  count?: number
  lastEvent?: string | null
}

/**
 * `GET /api/cgm` retourne un tableau plat de `CgmEntry` (DTO sérialisé) —
 * pas d'enveloppe `{ data: [...] }`. `valueGl` est en g/L, à convertir
 * en mg/dL via `× 100` (jamais `× 18`, voir CLAUDE.md `glToMgdl`).
 */
interface CgmEntry {
  timestamp: string
  valueGl: number
}

// ---------------------------------------------------------------------------
// Helper: authenticated fetch
// ---------------------------------------------------------------------------

/**
 * Résultat d'un appel API : data si OK, sinon discriminant pour distinguer
 * une expiration de session (401) d'une autre erreur (500, 404, etc.). Le
 * caller doit traiter `unauthorized: true` en redirigeant vers /login —
 * un `null` brut piégeait l'utilisateur dans un état error avec bouton
 * « Réessayer » qui ne marche jamais.
 */
type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; unauthorized: boolean }

async function apiFetch<T>(url: string, signal?: AbortSignal): Promise<ApiResult<T>> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "X-Requested-With": "XMLHttpRequest" },
    signal,
  })
  if (!res.ok) {
    return { ok: false, unauthorized: res.status === 401 }
  }
  const data = (await res.json()) as T
  return { ok: true, data }
}

// ---------------------------------------------------------------------------
// Helper: map API responses → WidgetData
// ---------------------------------------------------------------------------

function buildWidgetData(
  profile: GlycemicProfileApiResponse | null,
  tir: TimeInRangeApiResponse | null,
  hypo: HypoglycemiaApiResponse | null
): WidgetData {
  return {
    averageGlucose:
      profile?.averageGlucose != null
        ? { value: profile.averageGlucose, unit: profile.averageGlucoseUnit ?? "mg/dL" }
        : undefined,
    hba1c:
      profile?.hba1c != null ? { value: profile.hba1c } : undefined,
    hypoglycemia:
      hypo != null
        ? {
            count: hypo.count ?? 0,
            lastEvent: hypo.lastEvent ? new Date(hypo.lastEvent) : undefined,
          }
        : undefined,
    timeInRange:
      tir != null
        ? {
            inRange: tir.inRange ?? 0,
            low: tir.low ?? 0,
            veryLow: tir.veryLow ?? 0,
            high: tir.high ?? 0,
            veryHigh: tir.veryHigh ?? 0,
            readingCount: tir.readingCount,
          }
        : undefined,
    cv:
      profile?.cv != null ? { value: profile.cv } : undefined,
    standardDeviation:
      profile?.standardDeviation != null
        ? {
            value: profile.standardDeviation,
            unit: profile.standardDeviationUnit ?? "mg/dL",
          }
        : undefined,
  }
}

// ---------------------------------------------------------------------------
// Helper: build CGM date range query params from period
// ---------------------------------------------------------------------------

function buildCgmDateRange(period: TimePeriod): { from: string; to: string } {
  const to = new Date()
  const from = new Date(to)

  switch (period) {
    case TimePeriod.OneWeek:
      from.setDate(from.getDate() - 7)
      break
    case TimePeriod.TwoWeeks:
      from.setDate(from.getDate() - 14)
      break
    case TimePeriod.OneMonth:
      from.setDate(from.getDate() - 30)
      break
    case TimePeriod.ThreeMonths:
      from.setDate(from.getDate() - 90)
      break
  }

  return {
    from: from.toISOString(),
    to: to.toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function GlycemiaDashboardPage() {
  const t = useTranslations("dashboard")
  const tCommon = useTranslations("common")
  const locale = useLocale()
  const router = useRouter()

  // Period state — default 14 days
  const [period, setPeriod] = useState<TimePeriod>(TimePeriod.TwoWeeks)

  // Data state
  const [widgetData, setWidgetData] = useState<WidgetData>({})
  const [glucoseData, setGlucoseData] = useState<GlucoseDataPoint[]>([])

  // UI state
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isNewEventOpen, setIsNewEventOpen] = useState(false)

  // Auto-refresh interval ref (cleanup on unmount)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // AbortController courant — annule la requête précédente quand l'utilisateur
  // change rapidement de période, sinon la réponse lente de l'ancienne période
  // peut écraser celle de la nouvelle (race condition silencieuse).
  const abortRef = useRef<AbortController | null>(null)

  // ---------------------------------------------------------------------------
  // Fetch all dashboard data
  // ---------------------------------------------------------------------------

  const fetchAll = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? false

      // Annule la requête en vol avant d'en lancer une nouvelle.
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      if (!silent) setLoading(true)
      else setIsRefreshing(true)

      setError(false)

      try {
        const apiPeriod = PERIOD_TO_API[period]
        const { from, to } = buildCgmDateRange(period)

        const [profile, tir, hypo, cgm] = await Promise.all([
          apiFetch<GlycemicProfileApiResponse>(
            `/api/analytics/glycemic-profile?period=${apiPeriod}`,
            controller.signal,
          ),
          apiFetch<TimeInRangeApiResponse>(
            `/api/analytics/time-in-range?period=${apiPeriod}`,
            controller.signal,
          ),
          apiFetch<HypoglycemiaApiResponse>(
            `/api/analytics/hypoglycemia?period=${apiPeriod}`,
            controller.signal,
          ),
          apiFetch<CgmEntry[]>(
            `/api/cgm?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
            controller.signal,
          ),
        ])

        // Aborted (newer fetch in flight) → drop ce cycle silencieusement.
        if (controller.signal.aborted) return

        // Session expirée (401 sur n'importe quel endpoint) → relog. Sans
        // cette branche, l'utilisateur restait coincé en error state avec
        // un bouton « Réessayer » qui re-faisait des 401.
        const results = [profile, tir, hypo, cgm]
        if (results.some((r) => !r.ok && r.unauthorized)) {
          router.push("/login")
          return
        }

        // At least one API call must have returned data; otherwise treat as error
        if (results.every((r) => !r.ok)) {
          setError(true)
          return
        }

        // Build WidgetData from API responses (helpers attendent null si missing).
        setWidgetData(
          buildWidgetData(
            profile.ok ? profile.data : null,
            tir.ok ? tir.data : null,
            hypo.ok ? hypo.data : null,
          ),
        )

        // Map CGM entries to chart data points.
        // L'API retourne un tableau plat (pas d'enveloppe `{ data }`).
        // valueGl en g/L → mg/dL : × 100 (jamais × 18, voir CLAUDE.md).
        const cgmEntries: CgmEntry[] = cgm.ok && Array.isArray(cgm.data) ? cgm.data : []
        const points: GlucoseDataPoint[] = cgmEntries
          .map((entry) => {
            const ts = new Date(entry.timestamp)
            if (Number.isNaN(ts.getTime())) return null
            return {
              time: ts.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
              timestamp: ts,
              glucose: Math.round(entry.valueGl * 100),
            }
          })
          .filter((p): p is GlucoseDataPoint => p !== null)

        setGlucoseData(points)
      } catch (e) {
        // AbortError = nouveau fetch en route, ne pas afficher d'erreur.
        if (e instanceof DOMException && e.name === "AbortError") return
        setError(true)
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
          setIsRefreshing(false)
        }
      }
    },
    [period, locale, router],
  )

  // ---------------------------------------------------------------------------
  // Initial fetch + period change
  // ---------------------------------------------------------------------------

  useEffect(() => {
    void fetchAll()
  }, [fetchAll])

  // ---------------------------------------------------------------------------
  // Auto-refresh every 5 minutes (silent — no full skeleton re-render)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      void fetchAll({ silent: true })
    }, REFRESH_INTERVAL_MS)

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current)
      }
    }
  }, [fetchAll])

  // ---------------------------------------------------------------------------
  // Manual refresh handler
  // ---------------------------------------------------------------------------

  const handleRefresh = useCallback(() => {
    void fetchAll({ silent: true })
  }, [fetchAll])

  // ---------------------------------------------------------------------------
  // Period change handler
  // ---------------------------------------------------------------------------

  const handlePeriodChange = useCallback((newPeriod: TimePeriod) => {
    setPeriod(newPeriod)
    // fetchAll will be triggered by the period dependency in useEffect
  }, [])

  // ---------------------------------------------------------------------------
  // New event dialog handler (placeholder — opens when dialog is implemented)
  // ---------------------------------------------------------------------------

  const handleNewEvent = useCallback(() => {
    setIsNewEventOpen(true)
  }, [])

  // ---------------------------------------------------------------------------
  // Render: Error state
  // ---------------------------------------------------------------------------

  if (error && !loading) {
    return (
      <main className="flex-1 p-4 sm:p-6">
        <DiabeoEmptyState
          variant="error"
          action={{
            label: tCommon("retry"),
            onClick: () => void fetchAll(),
          }}
        />
      </main>
    )
  }

  // ---------------------------------------------------------------------------
  // Render: Success / Loading
  // ---------------------------------------------------------------------------

  return (
    <main className="flex-1 min-h-0 overflow-y-auto">
      {/* Live region for screen readers — announces refresh status */}
      <div role="status" aria-live="polite" className="sr-only">
        {isRefreshing ? tCommon("loading") : ""}
      </div>

      {/* Page header */}
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-gray-100 bg-white px-4 py-3 sm:px-6">
        {/* Title + period selector */}
        <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
          <h1 className="text-base font-semibold text-gray-900 sm:text-lg">
            {t("glycemiaTitle")}
          </h1>
          <PeriodSelector
            selectedPeriod={period}
            onPeriodSelected={handlePeriodChange}
          />
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-2">
          {/* Refresh button */}
          <DiabeoButton
            variant="diabeoGhost"
            size="icon"
            onClick={handleRefresh}
            aria-label={tCommon("refresh")}
            loading={isRefreshing}
            title={tCommon("refresh")}
          >
            {!isRefreshing && (
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
            )}
          </DiabeoButton>

          {/* "Nouvel evenement" — desktop only */}
          <div className="hidden md:block">
            <DiabeoButton
              variant="diabeoPrimary"
              size="default"
              onClick={handleNewEvent}
              aria-label={t("newEvent")}
              icon={<Plus className="h-4 w-4" aria-hidden="true" />}
            >
              {t("newEvent")}
            </DiabeoButton>
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="space-y-4 p-4 sm:space-y-6 sm:p-6">
        {/* --- Metrics grid --- */}
        <DataSummaryGrid
          data={widgetData}
          loading={loading}
          showTitle
        />

        {/* --- CGM chart --- */}
        <section
          aria-label={t("glycemiaTitle")}
          className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5"
        >
          {loading ? (
            /* Chart skeleton */
            <div
              aria-hidden="true"
              className="h-[240px] animate-pulse rounded-lg bg-gray-100 sm:h-[300px] md:h-[360px]"
            />
          ) : glucoseData.length === 0 ? (
            <DiabeoEmptyState variant="noData" />
          ) : (
            <GlycemiaEvolutionChart glucoseData={glucoseData} />
          )}
        </section>
      </div>

      {/* FAB — mobile only (md+ uses the header button) */}
      <div className="md:hidden" aria-hidden={isNewEventOpen}>
        <DiabeoFAB
          icon={<Plus />}
          label={t("newEvent")}
          onClick={handleNewEvent}
        />
      </div>

      {/*
        TODO: "Nouvel evenement" dialog implementation (US-WEB-202).
        isNewEventOpen state is wired; dialog component will be added here.
        Placeholder close handler:
          setIsNewEventOpen(false)
      */}
    </main>
  )
}
