"use client"

/**
 * Glycemic Profile page — WEB-202
 *
 * Displays a comprehensive glycemic profile for the selected period including:
 * - Period selector (1W / 2W / 1M / 3M)
 * - Date range display
 * - 6-metric DataSummaryGrid (avg, HbA1c, hypo, TIR, CV, SD)
 * - Data capture rate indicator (green ≥70%, amber ≥50%, red <50%)
 * - AGP (Ambulatory Glucose Profile) chart with percentile bands
 * - Time In Range chart (5-zone pie + stacked bar)
 * - Hypoglycemia counter with daily histogram
 *
 * Clinical references:
 *   - AGP report: Danne et al., Diabetes Care 2017 — 10th/25th/median/75th/90th percentiles
 *   - Data sufficiency threshold: 70% per AGP guidelines
 *   - TIR target: ≥70% between 70–180 mg/dL (International Consensus 2019)
 *
 * Security: all API calls use credentials: "include" + X-Requested-With header.
 * No patient PII is logged client-side.
 */

import { useState, useEffect, useCallback } from "react"
import { useTranslations } from "next-intl"
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts"
import { AlertTriangle, RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"

import { PeriodSelector, TimePeriod } from "@/components/diabeo/PeriodSelector"
import { DataSummaryGrid } from "@/components/diabeo/widgets/DataSummaryGrid"
import { TimeInRangeChart } from "@/components/diabeo/charts/TimeInRangeChart"
import { HypoglycemiaCounter } from "@/components/diabeo/charts/HypoglycemiaCounter"
import { DiabeoEmptyState } from "@/components/diabeo/DiabeoEmptyState"
import { DiabeoCard } from "@/components/diabeo/DiabeoCard"
import type { WidgetData } from "@/components/diabeo/widgets/types"
import type { TimeInRangeData, HypoglycemiaData } from "@/components/diabeo/charts/types"

// ─── Types ────────────────────────────────────────────────────────────────────

interface GlycemicProfileResponse {
  avg: number
  hba1c: number
  cv: number
  sd: number
  tir: {
    veryLow: number
    low: number
    inRange: number
    high: number
    veryHigh: number
  }
  captureRate: number
}

interface TirApiResponse {
  veryLow: number
  low: number
  inRange: number
  high: number
  veryHigh: number
}

/** AGP slot: one of the 96 five-minute intervals across 24h */
interface AgpSlot {
  /** "HH:MM" — 0:00 to 23:55 */
  time: string
  p10: number
  p25: number
  median: number
  p75: number
  p90: number
}

interface HypoApiResponse {
  totalCount: number
  lastEventTime?: string
  dailyCounts: { date: string; count: number }[]
}

type PageState = "idle" | "loading" | "error" | "insufficientData" | "success"

// ─── Helpers ─────────────────────────────────────────────────────────────────

const API_HEADERS: HeadersInit = {
  "X-Requested-With": "XMLHttpRequest",
}

const FETCH_OPTS: RequestInit = {
  credentials: "include",
  headers: API_HEADERS,
}

/** Convert period enum to query param string */
function periodToParam(period: TimePeriod): string {
  const map: Record<TimePeriod, string> = {
    "1W": "7d",
    "2W": "14d",
    "1M": "30d",
    "3M": "90d",
  }
  return map[period]
}

/** Compute date range from period — returns [from, to] as Date objects */
function computeDateRange(period: TimePeriod): [Date, Date] {
  const to = new Date()
  const days = period === "1W" ? 7 : period === "2W" ? 14 : period === "1M" ? 30 : 90
  const from = new Date(to.getTime() - days * 24 * 3600 * 1000)
  return [from, to]
}

/** Format a Date for the date range display */
function formatDate(date: Date, locale: string): string {
  return date.toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

/** Derive capture rate badge color */
function captureRateColor(rate: number): string {
  if (rate >= 70) return "text-emerald-600 bg-emerald-50"
  if (rate >= 50) return "text-amber-600 bg-amber-50"
  return "text-red-600 bg-red-50"
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const t = useTranslations("analytics")
  const tCommon = useTranslations("common")

  const [period, setPeriod] = useState<TimePeriod>(TimePeriod.TwoWeeks)
  const [pageState, setPageState] = useState<PageState>("idle")

  const [profileData, setProfileData] = useState<GlycemicProfileResponse | null>(null)
  const [tirData, setTirData] = useState<TirApiResponse | null>(null)
  const [agpData, setAgpData] = useState<AgpSlot[]>([])
  const [hypoData, setHypoData] = useState<HypoApiResponse | null>(null)

  const [dateRange, setDateRange] = useState<[Date, Date]>(computeDateRange(period))

  // ── Data fetching ──────────────────────────────────────────────────────────

  const fetchAll = useCallback(async (selectedPeriod: TimePeriod) => {
    setPageState("loading")
    const param = periodToParam(selectedPeriod)

    try {
      const [profileRes, tirRes, agpRes, hypoRes] = await Promise.all([
        fetch(`/api/analytics/glycemic-profile?period=${param}`, FETCH_OPTS),
        fetch(`/api/analytics/time-in-range?period=${param}`, FETCH_OPTS),
        fetch(`/api/analytics/agp?period=${param}`, FETCH_OPTS),
        fetch(`/api/analytics/hypoglycemia?period=${param}`, FETCH_OPTS),
      ])

      if (!profileRes.ok || !tirRes.ok || !agpRes.ok || !hypoRes.ok) {
        setPageState("error")
        return
      }

      const [profile, tir, agp, hypo] = await Promise.all([
        profileRes.json() as Promise<GlycemicProfileResponse>,
        tirRes.json() as Promise<TirApiResponse>,
        agpRes.json() as Promise<AgpSlot[]>,
        hypoRes.json() as Promise<HypoApiResponse>,
      ])

      if (profile.captureRate < 50 && agp.length === 0) {
        setProfileData(profile)
        setPageState("insufficientData")
        return
      }

      setProfileData(profile)
      setTirData(tir)
      setAgpData(agp)
      setHypoData(hypo)
      setPageState("success")
    } catch {
      setPageState("error")
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const range = computeDateRange(period)

    async function load() {
      setDateRange(range)
      await fetchAll(period)
    }

    if (!cancelled) void load()
    return () => { cancelled = true }
  }, [period, fetchAll])

  // ── Derived widget data ────────────────────────────────────────────────────

  const widgetData: WidgetData = profileData
    ? {
        averageGlucose: { value: Math.round(profileData.avg), unit: "mg/dL" },
        hba1c: { value: Number(profileData.hba1c.toFixed(1)) },
        hypoglycemia: {
          count: hypoData?.totalCount ?? 0,
          lastEvent: hypoData?.lastEventTime ? new Date(hypoData.lastEventTime) : undefined,
        },
        timeInRange: {
          inRange: tirData?.inRange ?? profileData.tir.inRange,
          low: tirData?.low ?? profileData.tir.low,
          veryLow: tirData?.veryLow ?? profileData.tir.veryLow,
          high: tirData?.high ?? profileData.tir.high,
          veryHigh: tirData?.veryHigh ?? profileData.tir.veryHigh,
        },
        cv: { value: Number(profileData.cv.toFixed(1)) },
        standardDeviation: { value: Math.round(profileData.sd), unit: "mg/dL" },
      }
    : {}

  const tirChartData: TimeInRangeData = tirData ?? {
    veryLow: 0, low: 0, inRange: 0, high: 0, veryHigh: 0,
  }

  const hypoChartData: HypoglycemiaData = {
    totalCount: hypoData?.totalCount ?? 0,
    lastEventTime: hypoData?.lastEventTime ? new Date(hypoData.lastEventTime) : undefined,
    dailyCounts: hypoData?.dailyCounts ?? [],
  }

  const captureRate = profileData?.captureRate ?? 0

  // ── Render helpers ────────────────────────────────────────────────────────

  if (pageState === "error") {
    return (
      <div className="p-6">
        <DiabeoEmptyState
          variant="error"
          action={{ label: tCommon("retry"), onClick: () => void fetchAll(period) }}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{t("title")}</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            {formatDate(dateRange[0], "fr-FR")} — {formatDate(dateRange[1], "fr-FR")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {pageState === "loading" && (
            <RefreshCw
              className="h-4 w-4 animate-spin text-teal-600"
              aria-label={tCommon("loading")}
            />
          )}
          <PeriodSelector selectedPeriod={period} onPeriodSelected={setPeriod} />
        </div>
      </div>

      {/* ── Insufficient data warning ────────────────────────────────────────── */}
      {pageState === "insufficientData" && profileData && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-amber-800">
              {t("insufficientDataTitle")}
            </p>
            <p className="mt-0.5 text-xs text-amber-700">
              {t("insufficientDataMessage", { rate: Math.round(captureRate) })}
            </p>
          </div>
        </div>
      )}

      {/* ── Data Summary Grid ─────────────────────────────────────────────────── */}
      <DiabeoCard variant="outlined" padding="md">
        <DataSummaryGrid
          data={widgetData}
          loading={pageState === "loading"}
        />
      </DiabeoCard>

      {/* ── Data capture indicator ────────────────────────────────────────────── */}
      {(pageState === "success" || pageState === "insufficientData") && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">{t("captureRate")}:</span>
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-semibold",
              captureRateColor(captureRate)
            )}
            aria-label={`${t("captureRate")}: ${Math.round(captureRate)}%`}
          >
            {Math.round(captureRate)}%
          </span>
          {captureRate < 70 && (
            <span className="text-xs text-gray-400">
              {t("captureRateTarget")}
            </span>
          )}
        </div>
      )}

      {/* ── AGP Chart ────────────────────────────────────────────────────────── */}
      <DiabeoCard variant="elevated" padding="md">
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">{t("agpTitle")}</h2>
            <p className="mt-0.5 text-xs text-gray-500">{t("agpSubtitle")}</p>
          </div>

          {pageState === "loading" ? (
            <div className="h-[280px] animate-pulse rounded-lg bg-gray-100" aria-busy="true" />
          ) : agpData.length === 0 ? (
            <DiabeoEmptyState variant="noData" />
          ) : (
            <>
              <div
                role="img"
                aria-label={t("agpChartLabel")}
                className="h-[280px]"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={agpData}
                    margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                  >
                    <defs>
                      {/* p10–p90: lightest band */}
                      <linearGradient id="agpBandOuter" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#0D9488" stopOpacity={0.08} />
                        <stop offset="100%" stopColor="#0D9488" stopOpacity={0.08} />
                      </linearGradient>
                      {/* p25–p75: darker band */}
                      <linearGradient id="agpBandInner" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#0D9488" stopOpacity={0.2} />
                        <stop offset="100%" stopColor="#0D9488" stopOpacity={0.2} />
                      </linearGradient>
                    </defs>

                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />

                    {/* Target range band (70–180 mg/dL) */}
                    <defs>
                      <linearGradient id="targetRange" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10B981" stopOpacity={0.06} />
                        <stop offset="100%" stopColor="#10B981" stopOpacity={0.06} />
                      </linearGradient>
                    </defs>

                    {/* Threshold reference lines */}
                    <ReferenceLine y={70} stroke="#F59E0B" strokeDasharray="4 4" strokeWidth={1} />
                    <ReferenceLine y={180} stroke="#F59E0B" strokeDasharray="4 4" strokeWidth={1} />
                    <ReferenceLine y={54} stroke="#EF4444" strokeDasharray="2 2" strokeWidth={1} />
                    <ReferenceLine y={250} stroke="#EF4444" strokeDasharray="2 2" strokeWidth={1} />

                    <XAxis
                      dataKey="time"
                      tick={{ fontSize: 11, fill: "#9CA3AF" }}
                      tickLine={false}
                      axisLine={{ stroke: "#E5E7EB" }}
                      interval={11}
                    />
                    <YAxis
                      domain={[40, 350]}
                      tick={{ fontSize: 11, fill: "#9CA3AF" }}
                      tickLine={false}
                      axisLine={{ stroke: "#E5E7EB" }}
                      width={36}
                      unit=" "
                    />

                    <RechartsTooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null
                        const slot = payload[0]?.payload as AgpSlot
                        if (!slot) return null
                        return (
                          <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-lg text-xs space-y-0.5">
                            <p className="font-semibold text-gray-900">{slot.time}</p>
                            <p className="text-teal-700">{t("agpMedian")}: <strong>{slot.median}</strong> mg/dL</p>
                            <p className="text-teal-500">{t("agpIqr")}: {slot.p25}–{slot.p75}</p>
                            <p className="text-teal-300">{t("agpRange")}: {slot.p10}–{slot.p90}</p>
                          </div>
                        )
                      }}
                    />

                    {/* p10–p90 outer band */}
                    <Area
                      type="monotone"
                      dataKey="p90"
                      stroke="none"
                      fill="url(#agpBandOuter)"
                      stackId="1"
                    />
                    <Area
                      type="monotone"
                      dataKey="p10"
                      stroke="none"
                      fill="#FFFFFF"
                      stackId="1"
                    />

                    {/* p25–p75 inner band */}
                    <Area
                      type="monotone"
                      dataKey="p75"
                      stroke="none"
                      fill="url(#agpBandInner)"
                      stackId="2"
                    />
                    <Area
                      type="monotone"
                      dataKey="p25"
                      stroke="none"
                      fill="#FFFFFF"
                      stackId="2"
                    />

                    {/* Median line */}
                    <Area
                      type="monotone"
                      dataKey="median"
                      stroke="#0D9488"
                      strokeWidth={2}
                      fill="none"
                      dot={false}
                      activeDot={{ r: 4, fill: "#0D9488", stroke: "white", strokeWidth: 2 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* AGP legend */}
              <div className="flex flex-wrap justify-center gap-4 text-xs text-gray-500">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-0.5 w-5 bg-teal-600" />
                  {t("agpLegendMedian")}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-3 w-5 rounded-sm bg-teal-600/20" />
                  {t("agpLegendIqr")}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-3 w-5 rounded-sm bg-teal-600/08" />
                  {t("agpLegendRange")}
                </span>
              </div>

              {/* Screen-reader accessible AGP data table */}
              <table className="sr-only" aria-label={t("agpChartLabel")}>
                <thead>
                  <tr>
                    <th scope="col">{t("agpTime")}</th>
                    <th scope="col">{t("agpMedian")}</th>
                    <th scope="col">P10</th>
                    <th scope="col">P25</th>
                    <th scope="col">P75</th>
                    <th scope="col">P90</th>
                  </tr>
                </thead>
                <tbody>
                  {agpData
                    .filter((_, i) => i % 12 === 0)
                    .map((slot) => (
                      <tr key={slot.time}>
                        <td>{slot.time}</td>
                        <td>{slot.median}</td>
                        <td>{slot.p10}</td>
                        <td>{slot.p25}</td>
                        <td>{slot.p75}</td>
                        <td>{slot.p90}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </DiabeoCard>

      {/* ── TIR + Hypo ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Time In Range */}
        <DiabeoCard variant="elevated" padding="md">
          {pageState === "loading" ? (
            <div className="h-48 animate-pulse rounded-lg bg-gray-100" aria-busy="true" />
          ) : (
            <TimeInRangeChart data={tirChartData} />
          )}
        </DiabeoCard>

        {/* Hypoglycemia */}
        <DiabeoCard variant="elevated" padding="md">
          {pageState === "loading" ? (
            <div className="h-48 animate-pulse rounded-lg bg-gray-100" aria-busy="true" />
          ) : (
            <HypoglycemiaCounter data={hypoChartData} />
          )}
        </DiabeoCard>
      </div>
    </div>
  )
}
