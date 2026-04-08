"use client"

/**
 * Weekly View page — WEB-203
 *
 * Displays a week-by-week overview of patient glucose data.
 * Three tabs:
 *   - Semainier (implemented): 7 compact daily mini-charts + weekly stats
 *   - Historique: placeholder "coming soon"
 *   - Tableau: placeholder "coming soon"
 *
 * Week navigation: prev/next arrows advancing or retreating 7 days.
 * Weekly stats: average glucose, TIR%, total readings, insulin total.
 *
 * Layout:
 *   Desktop: 2-column grid of daily charts
 *   Mobile:  1-column stacked, touch-swipeable (CSS scroll-snap)
 *
 * Clinical note:
 *   Mini-charts use GlycemiaEvolutionChart with height=180.
 *   Insulin data is optional; charts gracefully degrade when absent.
 *
 * Security: all API calls include credentials: "include" + X-Requested-With.
 * No PII is logged client-side.
 */

import { useState, useEffect, useCallback, useRef } from "react"
import { useTranslations } from "next-intl"
import { ChevronLeft, ChevronRight, RefreshCw, Clock } from "lucide-react"
import { cn } from "@/lib/utils"

import { GlycemiaEvolutionChart } from "@/components/diabeo/charts/GlycemiaEvolutionChart"
import { DiabeoEmptyState } from "@/components/diabeo/DiabeoEmptyState"
import { DiabeoCard } from "@/components/diabeo/DiabeoCard"
import type { GlucoseDataPoint } from "@/components/diabeo/charts/types"

// ─── Types ────────────────────────────────────────────────────────────────────

interface DayData {
  date: Date
  glucoseData: GlucoseDataPoint[]
  avgGlucose: number | null
  tirPercent: number | null
  readingsCount: number
}

interface WeeklyStats {
  avgGlucose: number | null
  tirPercent: number | null
  totalReadings: number
  totalInsulin: number | null
}

interface CgmEntry {
  timestamp: string
  glucoseValue: number
}

type PageState = "idle" | "loading" | "error" | "success" | "empty"
type WeeklyTab = "semainier" | "historique" | "tableau"

// ─── Constants ────────────────────────────────────────────────────────────────

const API_HEADERS: HeadersInit = {
  "X-Requested-With": "XMLHttpRequest",
}

const FETCH_OPTS: RequestInit = {
  credentials: "include",
  headers: API_HEADERS,
}

/** Tab configuration — only "semainier" is currently implemented */
const TABS: { key: WeeklyTab; labelKey: string }[] = [
  { key: "historique", labelKey: "tabHistory" },
  { key: "tableau", labelKey: "tabTable" },
  { key: "semainier", labelKey: "tabWeekly" },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Get the Monday of the week containing the given date */
function getWeekStart(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

/** Build array of 7 Date objects starting from weekStart */
function getWeekDays(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + i)
    return d
  })
}

/** Format ISO date string "YYYY-MM-DD" */
function toIsoDate(date: Date): string {
  return date.toISOString().split("T")[0]!
}

/** Format week range title e.g. "31 Mar - 6 Avr 2026" */
function formatWeekTitle(weekStart: Date, locale: string): string {
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 6)

  const startLabel = weekStart.toLocaleDateString(locale, { day: "numeric", month: "short" })
  const endLabel = weekEnd.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })
  return `${startLabel} – ${endLabel}`
}

/** Format a single day label e.g. "Lun 31" */
function formatDayLabel(date: Date, locale: string): string {
  return date.toLocaleDateString(locale, { weekday: "short", day: "numeric" })
}

/** Check if two dates represent the same calendar day */
function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/** Compute average glucose from data points */
function computeAvg(points: GlucoseDataPoint[]): number | null {
  if (points.length === 0) return null
  return Math.round(points.reduce((s, p) => s + p.glucose, 0) / points.length)
}

/** Compute TIR percentage (70–180 mg/dL) */
function computeTir(points: GlucoseDataPoint[]): number | null {
  if (points.length === 0) return null
  const inRange = points.filter((p) => p.glucose >= 70 && p.glucose <= 180).length
  return Math.round((inRange / points.length) * 100)
}

/** Group flat CGM entries into per-day GlucoseDataPoint arrays */
function groupByDay(entries: CgmEntry[], days: Date[]): Map<string, GlucoseDataPoint[]> {
  const map = new Map<string, GlucoseDataPoint[]>()
  for (const day of days) {
    map.set(toIsoDate(day), [])
  }
  for (const entry of entries) {
    const ts = new Date(entry.timestamp)
    const key = toIsoDate(ts)
    if (map.has(key)) {
      const time = ts.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
      map.get(key)!.push({ time, timestamp: ts, glucose: entry.glucoseValue })
    }
  }
  return map
}

// ─── Stat card (inline — weekly summary) ─────────────────────────────────────

interface WeekStatCardProps {
  label: string
  value: string
  subLabel?: string
  className?: string
}

function WeekStatCard({ label, value, subLabel, className }: WeekStatCardProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-0.5 rounded-lg border border-gray-200 bg-white px-3 py-2.5",
        className
      )}
    >
      <span className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
        {label}
      </span>
      <span className="text-lg font-bold leading-tight text-gray-900">{value}</span>
      {subLabel && (
        <span className="text-[10px] text-gray-400">{subLabel}</span>
      )}
    </div>
  )
}

// ─── Coming soon placeholder ──────────────────────────────────────────────────

function ComingSoon({ tab }: { tab: WeeklyTab }) {
  const t = useTranslations("weekly")
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
      <Clock className="h-10 w-10 text-gray-300" aria-hidden="true" />
      <p className="text-base font-semibold text-gray-600">
        {t("comingSoon")}
      </p>
      <p className="text-sm text-gray-400">
        {t("comingSoonDesc", { tab: t(tab === "historique" ? "tabHistory" : "tabTable") })}
      </p>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function WeeklyPage() {
  const t = useTranslations("weekly")
  const tCommon = useTranslations("common")

  const [activeTab, setActiveTab] = useState<WeeklyTab>("semainier")
  const [weekStart, setWeekStart] = useState<Date>(() => getWeekStart(new Date()))
  const [pageState, setPageState] = useState<PageState>("idle")
  const [days, setDays] = useState<DayData[]>([])
  const [weeklyStats, setWeeklyStats] = useState<WeeklyStats>({
    avgGlucose: null,
    tirPercent: null,
    totalReadings: 0,
    totalInsulin: null,
  })

  // Ref for the swipeable daily chart container
  const chartGridRef = useRef<HTMLDivElement>(null)

  // ── Fetch week data ──────────────────────────────────────────────────────

  const fetchWeek = useCallback(async (start: Date) => {
    setPageState("loading")

    const weekDays = getWeekDays(start)
    const from = toIsoDate(start)
    const end = new Date(start)
    end.setDate(end.getDate() + 6)
    end.setHours(23, 59, 59, 999)
    const to = end.toISOString()

    try {
      const res = await fetch(
        `/api/cgm?from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(to)}`,
        FETCH_OPTS
      )

      if (!res.ok) {
        setPageState("error")
        return
      }

      const entries = (await res.json()) as CgmEntry[]

      if (entries.length === 0) {
        setDays(weekDays.map((date) => ({
          date,
          glucoseData: [],
          avgGlucose: null,
          tirPercent: null,
          readingsCount: 0,
        })))
        setPageState("empty")
        return
      }

      const grouped = groupByDay(entries, weekDays)
      const dayDataArray: DayData[] = weekDays.map((date) => {
        const glucoseData = grouped.get(toIsoDate(date)) ?? []
        return {
          date,
          glucoseData,
          avgGlucose: computeAvg(glucoseData),
          tirPercent: computeTir(glucoseData),
          readingsCount: glucoseData.length,
        }
      })

      const allPoints = dayDataArray.flatMap((d) => d.glucoseData)
      setDays(dayDataArray)
      setWeeklyStats({
        avgGlucose: computeAvg(allPoints),
        tirPercent: computeTir(allPoints),
        totalReadings: allPoints.length,
        totalInsulin: null, // TODO: fetch from insulin endpoint
      })
      setPageState("success")
    } catch {
      setPageState("error")
    }
    // Suppress unused variable warning — `from` is kept for clarity
    void from
  }, [])

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (activeTab === "semainier") {
        await fetchWeek(weekStart)
      }
    }

    if (!cancelled) void load()
    return () => { cancelled = true }
  }, [weekStart, activeTab, fetchWeek])

  // ── Week navigation ──────────────────────────────────────────────────────

  const goToPrevWeek = () => {
    setWeekStart((prev) => {
      const d = new Date(prev)
      d.setDate(d.getDate() - 7)
      return d
    })
  }

  const goToNextWeek = () => {
    setWeekStart((prev) => {
      const d = new Date(prev)
      d.setDate(d.getDate() + 7)
      return d
    })
  }

  const isCurrentWeek = isSameDay(getWeekStart(new Date()), weekStart)

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5 p-4 sm:p-6">
      {/* ── Page header ──────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">{t("title")}</h1>
      </div>

      {/* ── Tab navigation ───────────────────────────────────────────────────── */}
      <div
        role="tablist"
        aria-label={t("tabsLabel")}
        className="flex gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1 w-fit"
      >
        {TABS.map(({ key, labelKey }) => {
          const isActive = activeTab === key
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`panel-${key}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActiveTab(key)}
              className={cn(
                "px-4 py-1.5 text-sm font-medium rounded-md transition-colors duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-1",
                isActive
                  ? "bg-white text-teal-700 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              )}
            >
              {t(labelKey as Parameters<typeof t>[0])}
            </button>
          )
        })}
      </div>

      {/* ── Tab panels ───────────────────────────────────────────────────────── */}

      {/* Historique — not yet implemented */}
      <div
        id="panel-historique"
        role="tabpanel"
        aria-labelledby="tab-historique"
        hidden={activeTab !== "historique"}
      >
        <ComingSoon tab="historique" />
      </div>

      {/* Tableau — not yet implemented */}
      <div
        id="panel-tableau"
        role="tabpanel"
        aria-labelledby="tab-tableau"
        hidden={activeTab !== "tableau"}
      >
        <ComingSoon tab="tableau" />
      </div>

      {/* Semainier — main implementation */}
      <div
        id="panel-semainier"
        role="tabpanel"
        aria-labelledby="tab-semainier"
        hidden={activeTab !== "semainier"}
        className="space-y-5"
      >
        {/* Week navigation header */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={goToPrevWeek}
            aria-label={tCommon("previous")}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full",
              "border border-gray-200 bg-white text-gray-600",
              "hover:bg-teal-50 hover:text-teal-600 hover:border-teal-200",
              "transition-colors duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
            )}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>

          <div className="text-center">
            <p className="text-sm font-semibold text-gray-900">
              {formatWeekTitle(weekStart, "fr-FR")}
            </p>
            {isCurrentWeek && (
              <p className="text-xs text-teal-600 font-medium">{t("currentWeek")}</p>
            )}
          </div>

          <button
            type="button"
            onClick={goToNextWeek}
            disabled={isCurrentWeek}
            aria-label={tCommon("next")}
            aria-disabled={isCurrentWeek}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full",
              "border border-gray-200 bg-white text-gray-600",
              "hover:bg-teal-50 hover:text-teal-600 hover:border-teal-200",
              "transition-colors duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600",
              isCurrentWeek && "opacity-30 cursor-not-allowed pointer-events-none"
            )}
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Weekly stats row */}
        {pageState === "loading" ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-lg bg-gray-100"
                aria-hidden="true"
              />
            ))}
          </div>
        ) : pageState !== "error" && (
          <div
            className="grid grid-cols-2 gap-2 sm:grid-cols-4"
            aria-label={t("weeklyStats")}
          >
            <WeekStatCard
              label={t("statAvgGlucose")}
              value={weeklyStats.avgGlucose != null ? `${weeklyStats.avgGlucose} mg/dL` : "—"}
            />
            <WeekStatCard
              label={t("statTir")}
              value={weeklyStats.tirPercent != null ? `${weeklyStats.tirPercent}%` : "—"}
              subLabel={t("statTirTarget")}
            />
            <WeekStatCard
              label={t("statReadings")}
              value={weeklyStats.totalReadings > 0 ? String(weeklyStats.totalReadings) : "—"}
            />
            <WeekStatCard
              label={t("statInsulin")}
              value={weeklyStats.totalInsulin != null ? `${weeklyStats.totalInsulin.toFixed(1)} U` : "—"}
            />
          </div>
        )}

        {/* Loading spinner */}
        {pageState === "loading" && (
          <div className="flex justify-center py-4">
            <RefreshCw
              className="h-5 w-5 animate-spin text-teal-600"
              aria-label={tCommon("loading")}
            />
          </div>
        )}

        {/* Error state */}
        {pageState === "error" && (
          <DiabeoEmptyState
            variant="error"
            action={{
              label: tCommon("retry"),
              onClick: () => void fetchWeek(weekStart),
            }}
          />
        )}

        {/* Empty state */}
        {pageState === "empty" && (
          <DiabeoEmptyState variant="noData" />
        )}

        {/* Daily mini-charts grid */}
        {(pageState === "success" || (pageState === "empty" && days.length > 0)) && (
          <div
            ref={chartGridRef}
            className={cn(
              // Mobile: 1 column, scroll-snap for swipeable feel
              "grid grid-cols-1 gap-4",
              // Scroll snap container on mobile
              "sm:overflow-visible overflow-x-auto",
              // Desktop: 2 columns
              "sm:grid-cols-2"
            )}
            aria-label={t("dailyChartsLabel")}
          >
            {days.map((day) => (
              <DiabeoCard
                key={toIsoDate(day.date)}
                variant="elevated"
                padding="sm"
                className={cn(
                  // Mobile scroll-snap item
                  "min-w-[280px] sm:min-w-0",
                  "scroll-snap-align-start"
                )}
              >
                {/* Day header */}
                <div className="mb-2 flex items-center justify-between px-1">
                  <span className="text-xs font-semibold capitalize text-gray-700">
                    {formatDayLabel(day.date, "fr-FR")}
                  </span>
                  <div className="flex items-center gap-2 text-[11px] text-gray-400">
                    {day.avgGlucose != null && (
                      <span>{day.avgGlucose} mg/dL</span>
                    )}
                    {day.tirPercent != null && (
                      <span
                        className={cn(
                          "rounded-full px-1.5 py-0.5 font-medium",
                          day.tirPercent >= 70
                            ? "bg-emerald-50 text-emerald-700"
                            : day.tirPercent >= 50
                              ? "bg-amber-50 text-amber-700"
                              : "bg-red-50 text-red-700"
                        )}
                      >
                        TIR {day.tirPercent}%
                      </span>
                    )}
                    <span className="text-gray-300">{day.readingsCount} lect.</span>
                  </div>
                </div>

                {/* Mini chart */}
                <div style={{ height: 180 }}>
                  <GlycemiaEvolutionChart
                    glucoseData={day.glucoseData}
                    height={180}
                    className="h-full"
                  />
                </div>
              </DiabeoCard>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
