"use client"

/**
 * Radar Chart page — WEB-204
 *
 * Displays a weekly glycemic metric view (Mon–Sun) as a pure SVG radar chart.
 * Each of the 7 axes corresponds to a day of the week. The user can select
 * a time period (1W/2W/1M/3M) and a metric (TIR, Average Glucose, CV).
 *
 * States: loading skeleton, empty, error, data.
 * Companion data table below the chart for screen reader and data accessibility.
 *
 * i18n: "radar" namespace.
 * Accessibility: SVG has role="img" + aria-label. Data table is visible
 * (not sr-only) per product requirements.
 */

import { useState, useEffect, useId } from "react"
import { useTranslations } from "next-intl"
import { DashboardHeader } from "@/components/diabeo/DashboardHeader"
import { DiabeoCard } from "@/components/diabeo/DiabeoCard"
import { DiabeoEmptyState } from "@/components/diabeo/DiabeoEmptyState"
import { AlertBanner } from "@/components/diabeo/AlertBanner"
import { PeriodSelector, TimePeriod } from "@/components/diabeo/PeriodSelector"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MetricKey = "tir" | "averageGlucose" | "cv"

interface DayDataPoint {
  /** ISO day label key: "mon" | "tue" | ... */
  day: string
  value: number
  /** delta vs period average (positive = above, negative = below) */
  delta: number
}

interface RadarData {
  metric: MetricKey
  period: TimePeriod
  /** Average over the full period */
  average: number
  unit: string
  points: DayDataPoint[]
}

const DAYS: string[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
const METRICS: MetricKey[] = ["tir", "averageGlucose", "cv"]
const API_HEADERS = {
  "X-Requested-With": "XMLHttpRequest",
}

// ---------------------------------------------------------------------------
// Pure SVG Radar Chart
// ---------------------------------------------------------------------------

const SVG_SIZE = 320
const CENTER = SVG_SIZE / 2
const RADIUS = 120
const LEVELS = 4

function polarToCartesian(
  angle: number,
  r: number
): { x: number; y: number } {
  // 0° = top (-90° offset so first axis points up)
  const rad = ((angle - 90) * Math.PI) / 180
  return { x: CENTER + r * Math.cos(rad), y: CENTER + r * Math.sin(rad) }
}

interface RadarChartSVGProps {
  points: DayDataPoint[]
  maxValue: number
  dayLabels: string[]
  fillColor: string
  strokeColor: string
  chartLabel: string
}

function RadarChartSVG({
  points,
  maxValue,
  dayLabels,
  fillColor,
  strokeColor,
  chartLabel,
}: RadarChartSVGProps) {
  const axisCount = points.length
  const angleStep = 360 / axisCount
  const tooltipId = useId()
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  // Build polygon path
  const polygonPoints = points
    .map((p, i) => {
      const ratio = maxValue > 0 ? Math.min(p.value / maxValue, 1) : 0
      const { x, y } = polarToCartesian(i * angleStep, ratio * RADIUS)
      return `${x},${y}`
    })
    .join(" ")

  return (
    <svg
      viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
      width={SVG_SIZE}
      height={SVG_SIZE}
      role="img"
      aria-label={chartLabel}
      className="mx-auto block max-w-full"
    >
      {/* Tooltip definition */}
      <defs>
        <filter id={`${tooltipId}-shadow`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="1" stdDeviation="2" floodOpacity="0.15" />
        </filter>
      </defs>

      {/* Grid circles */}
      {Array.from({ length: LEVELS }, (_, i) => {
        const r = RADIUS * ((i + 1) / LEVELS)
        return (
          <circle
            key={i}
            cx={CENTER}
            cy={CENTER}
            r={r}
            fill="none"
            stroke="#e5e7eb"
            strokeWidth={1}
          />
        )
      })}

      {/* Axis lines + labels */}
      {points.map((_, i) => {
        const angle = i * angleStep
        const outer = polarToCartesian(angle, RADIUS)
        const labelPos = polarToCartesian(angle, RADIUS + 22)
        return (
          <g key={i}>
            <line
              x1={CENTER}
              y1={CENTER}
              x2={outer.x}
              y2={outer.y}
              stroke="#d1d5db"
              strokeWidth={1}
            />
            <text
              x={labelPos.x}
              y={labelPos.y}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={11}
              fill="#6b7280"
              fontWeight={500}
            >
              {dayLabels[i]}
            </text>
          </g>
        )
      })}

      {/* Filled polygon */}
      <polygon
        points={polygonPoints}
        fill={fillColor}
        fillOpacity={0.25}
        stroke={strokeColor}
        strokeWidth={2}
        strokeLinejoin="round"
      />

      {/* Interactive data points */}
      {points.map((p, i) => {
        const ratio = maxValue > 0 ? Math.min(p.value / maxValue, 1) : 0
        const { x, y } = polarToCartesian(i * angleStep, ratio * RADIUS)
        const isHovered = hoveredIndex === i
        return (
          <g
            key={i}
            onMouseEnter={() => setHoveredIndex(i)}
            onMouseLeave={() => setHoveredIndex(null)}
            onFocus={() => setHoveredIndex(i)}
            onBlur={() => setHoveredIndex(null)}
            tabIndex={0}
            role="button"
            aria-label={`${dayLabels[i]}: ${p.value.toFixed(1)}`}
            style={{ cursor: "pointer", outline: "none" }}
          >
            <circle
              cx={x}
              cy={y}
              r={isHovered ? 7 : 5}
              fill={strokeColor}
              stroke="white"
              strokeWidth={2}
              style={{ transition: "r 0.15s ease" }}
            />

            {/* Tooltip */}
            {isHovered && (
              <g filter={`url(#${tooltipId}-shadow)`}>
                <rect
                  x={x - 28}
                  y={y - 32}
                  width={56}
                  height={22}
                  rx={4}
                  fill="#1f2937"
                />
                <text
                  x={x}
                  y={y - 17}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={10}
                  fill="white"
                  fontWeight={600}
                >
                  {p.value.toFixed(1)}
                </text>
              </g>
            )}
          </g>
        )
      })}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function RadarSkeleton() {
  return (
    <div className="flex flex-col items-center gap-4 py-6">
      <div className="h-[320px] w-[320px] animate-pulse rounded-full bg-gray-100" />
      <div className="h-4 w-48 animate-pulse rounded bg-gray-100" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function RadarPage() {
  const t = useTranslations("radar")
  const tCommon = useTranslations("common")

  const [period, setPeriod] = useState<TimePeriod>(TimePeriod.OneWeek)
  const [metric, setMetric] = useState<MetricKey>("tir")
  const [data, setData] = useState<RadarData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Day labels (translated Mon–Sun)
  const dayLabels = DAYS.map((d) => t(`day.${d}` as Parameters<typeof t>[0]))

  // Metric display config
  const metricConfig: Record<MetricKey, { unit: string; maxValue: number; color: string; stroke: string }> = {
    tir: { unit: "%", maxValue: 100, color: "#0d9488", stroke: "#0d9488" },
    averageGlucose: { unit: "mg/dL", maxValue: 300, color: "#f97316", stroke: "#f97316" },
    cv: { unit: "%", maxValue: 60, color: "#8b5cf6", stroke: "#8b5cf6" },
  }

  // ── Fetch radar data ────────────────────────────────────────────────────────
  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({ period, metric })
        const res = await fetch(
          `/api/analytics/glycemic-profile?${params.toString()}`,
          { credentials: "include", headers: API_HEADERS }
        )
        if (!res.ok) {
          if (res.status === 404 || res.status === 204) {
            setData(null)
            return
          }
          throw new Error("fetchFailed")
        }
        const json = await res.json() as { weeklyRadar?: DayDataPoint[]; average?: number }

        // Map API response to radar data shape
        const rawPoints: DayDataPoint[] = json.weeklyRadar ?? []
        const average = json.average ?? 0
        const config = metricConfig[metric]

        // Pad missing days with 0
        const filledPoints: DayDataPoint[] = DAYS.map((day, i) => {
          const found = rawPoints[i]
          return found ?? { day, value: 0, delta: 0 }
        })

        setData({
          metric,
          period,
          average,
          unit: config.unit,
          points: filledPoints,
        })
      } catch {
        setError(t("errorLoading"))
      } finally {
        setIsLoading(false)
      }
    }
    void fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, metric])

  const config = metricConfig[metric]
  const isEmpty = !isLoading && !error && data !== null && data.points.every((p) => p.value === 0)

  return (
    <>
      <DashboardHeader title={t("title")} subtitle={t("subtitle")} />

      <div className="space-y-6 p-6">
        {/* Controls */}
        <div className="flex flex-wrap items-end gap-4">
          <PeriodSelector
            selectedPeriod={period}
            onPeriodSelected={setPeriod}
          />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="metric-select">{t("selectMetric")}</Label>
            <Select
              value={metric}
              onValueChange={(v) => { if (v !== null) setMetric(v as MetricKey) }}
            >
              <SelectTrigger id="metric-select" className="w-52" aria-label={t("selectMetric")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METRICS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {t(`metric.${m}` as Parameters<typeof t>[0])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Error */}
        {error && (
          <AlertBanner
            severity="warning"
            title={error}
            dismissible
            onDismiss={() => setError(null)}
          />
        )}

        {/* Chart card */}
        <DiabeoCard variant="elevated" padding="lg">
          <div className="flex flex-col gap-6">
            {/* Legend */}
            <div className="flex items-center gap-3">
              <div
                className="h-3 w-8 rounded-full opacity-80"
                style={{ backgroundColor: config.color }}
                aria-hidden="true"
              />
              <span className="text-sm font-medium text-foreground">
                {t(`metric.${metric}` as Parameters<typeof t>[0])}
              </span>
              {data && (
                <span className="ml-auto text-sm text-muted-foreground">
                  {t("average")}: <strong>{data.average.toFixed(1)}{data.unit}</strong>
                </span>
              )}
            </div>

            {isLoading && <RadarSkeleton />}

            {!isLoading && error === null && (
              <>
                {isEmpty ? (
                  <DiabeoEmptyState
                    variant="insufficientData"
                    title={t("noData")}
                    message={t("noDataMessage")}
                  />
                ) : data ? (
                  <RadarChartSVG
                    points={data.points}
                    maxValue={config.maxValue}
                    dayLabels={dayLabels}
                    fillColor={config.color}
                    strokeColor={config.stroke}
                    chartLabel={t(`metric.${metric}` as Parameters<typeof t>[0])}
                  />
                ) : null}
              </>
            )}
          </div>
        </DiabeoCard>

        {/* Companion data table */}
        {data && !isEmpty && !isLoading && (
          <DiabeoCard variant="outlined" padding="lg">
            <h2 className="mb-3 text-sm font-semibold text-foreground">
              {t("dataTableTitle")}
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label={t("dataTableLabel")}>
                <thead>
                  <tr className="border-b border-gray-200">
                    <th
                      scope="col"
                      className="py-2 pe-4 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                    >
                      {t("tableDay")}
                    </th>
                    <th
                      scope="col"
                      className="py-2 pe-4 text-end text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                    >
                      {t(`metric.${metric}` as Parameters<typeof t>[0])} ({data.unit})
                    </th>
                    <th
                      scope="col"
                      className="py-2 text-end text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                    >
                      {t("tableVsAverage")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.points.map((p, i) => (
                    <tr
                      key={p.day}
                      className={cn(
                        "border-b border-gray-100 last:border-0",
                        i % 2 === 0 ? "bg-white" : "bg-gray-50/50"
                      )}
                    >
                      <td className="py-2 pe-4 font-medium text-foreground">
                        {dayLabels[i]}
                      </td>
                      <td className="py-2 pe-4 text-end tabular-nums text-foreground">
                        {p.value.toFixed(1)}
                      </td>
                      <td
                        className={cn(
                          "py-2 text-end tabular-nums font-medium",
                          p.delta > 0
                            ? "text-amber-600"
                            : p.delta < 0
                              ? "text-teal-600"
                              : "text-muted-foreground"
                        )}
                      >
                        {p.delta > 0 ? "+" : ""}
                        {p.delta.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200">
                    <td className="py-2 pe-4 text-xs font-semibold text-muted-foreground">
                      {t("tableAverage")}
                    </td>
                    <td className="py-2 pe-4 text-end text-xs font-bold tabular-nums text-foreground">
                      {data.average.toFixed(1)}
                    </td>
                    <td className="py-2 text-end text-xs text-muted-foreground">—</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </DiabeoCard>
        )}
      </div>
    </>
  )
}
