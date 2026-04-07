"use client"

import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"
import { WidgetSkeleton } from "./WidgetSkeleton"
import type { WidgetProps } from "./types"

/**
 * Time In Range (TIR) Widget
 *
 * Shows the percentage of readings within the target range (70–180 mg/dL)
 * plus an optional mini stacked-bar visualising all 5 TIR zones.
 *
 * Color thresholds (International Consensus 2019):
 *   green  (>= 70 %) : meets recommended TIR target
 *   amber  (50–69 %) : below target, optimisation needed
 *   red    (< 50 %)  : significantly below target, clinical review required
 *
 * 5-zone model:
 *   Very Low  < 54 mg/dL
 *   Low       54–69 mg/dL
 *   In Range  70–180 mg/dL
 *   High      181–250 mg/dL
 *   Very High > 250 mg/dL
 */

export interface TimeInRangeWidgetProps extends WidgetProps {
  /** % time in range 70–180 mg/dL */
  inRange: number
  /** % time in low zone (54–69 mg/dL) */
  low: number
  /** % time in very-low zone (<54 mg/dL) */
  veryLow: number
  /** % time in high zone (181–250 mg/dL) */
  high: number
  /** % time in very-high zone (>250 mg/dL) */
  veryHigh: number
  /** Total number of CGM readings used to compute these percentages */
  readingCount?: number
}

function getTirColorClass(inRange: number): string {
  if (inRange >= 70) return "text-glycemia-normal"
  if (inRange >= 50) return "text-glycemia-high"
  return "text-glycemia-low"
}

/**
 * Stacked bar showing the 5 TIR zones proportionally.
 * Heights correspond to the respective percentages.
 * Each segment has an aria-label for screen readers.
 */
function TirStackedBar({
  veryLow,
  low,
  inRange,
  high,
  veryHigh,
  tZoneLabel,
  distributionLabel,
}: {
  veryLow: number
  low: number
  inRange: number
  high: number
  veryHigh: number
  tZoneLabel: (key: string, pct: number) => string
  distributionLabel: string
}) {
  const segments: Array<{ pct: number; bgClass: string; zoneKey: string }> = [
    { pct: veryLow, bgClass: "bg-tir-very-low", zoneKey: "veryLow" },
    { pct: low, bgClass: "bg-tir-low", zoneKey: "low" },
    { pct: inRange, bgClass: "bg-tir-in-range", zoneKey: "inRange" },
    { pct: high, bgClass: "bg-tir-high", zoneKey: "high" },
    { pct: veryHigh, bgClass: "bg-tir-very-high", zoneKey: "veryHigh" },
  ]

  return (
    <div
      className="flex rounded overflow-hidden h-1.5 mt-2 w-full"
      role="img"
      aria-label={distributionLabel}
    >
      {segments.map(({ pct, bgClass, zoneKey }) => {
        const segmentLabel = tZoneLabel(zoneKey, pct)
        return pct > 0 ? (
          <div
            key={zoneKey}
            className={cn(bgClass, "h-full")}
            style={{ width: `${pct}%` }}
            title={segmentLabel}
          />
        ) : null
      })}
    </div>
  )
}

export function TimeInRangeWidget({
  inRange,
  low,
  veryLow,
  high,
  veryHigh,
  readingCount,
  loading,
  onClick,
  className,
}: TimeInRangeWidgetProps) {
  const t = useTranslations("metrics")

  if (loading) {
    return <WidgetSkeleton className={className} />
  }

  const colorClass = getTirColorClass(inRange)
  const label = t("timeInRange")

  const tZoneLabel = (key: string, pct: number): string =>
    `${t(`tir.${key}` as Parameters<typeof t>[0])}: ${pct}%`

  const distributionLabel = `${t("tir.distribution")}: ${t("tir.veryLow")} ${veryLow}%, ${t("tir.low")} ${low}%, ${t("tir.inRange")} ${inRange}%, ${t("tir.high")} ${high}%, ${t("tir.veryHigh")} ${veryHigh}%`

  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                onClick()
              }
            }
          : undefined
      }
      className={cn(
        "rounded-lg bg-white p-4 shadow-sm",
        onClick && "cursor-pointer hover:shadow-md transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600",
        className
      )}
      aria-label={`${label}: ${inRange}%${readingCount !== undefined ? `, ${readingCount} ${t("readings")}` : ""}`}
    >
      <p className="text-xs text-gray-500 mb-1 font-medium truncate">{label}</p>
      <p className={cn("text-2xl font-bold leading-tight", colorClass)}>
        {inRange}
        <span className="text-sm font-medium ms-0.5">%</span>
      </p>
      {readingCount !== undefined && (
        <p className="text-xs text-gray-400 mt-0.5">
          {readingCount} {t("readings")}
        </p>
      )}
      <TirStackedBar
        veryLow={veryLow}
        low={low}
        inRange={inRange}
        high={high}
        veryHigh={veryHigh}
        tZoneLabel={tZoneLabel}
        distributionLabel={distributionLabel}
      />
    </div>
  )
}
