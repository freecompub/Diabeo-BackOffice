"use client"

import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"
import { WidgetSkeleton } from "./WidgetSkeleton"
import type { WidgetProps } from "./types"

/**
 * Average Glucose Widget
 *
 * Displays the mean glucose value over the selected period.
 *
 * Color thresholds (mg/dL — international consensus):
 *   green  (<= 180)  : in-range average, good control
 *   amber  (181–250) : elevated average, review therapy
 *   red    (> 250)   : high average, action required
 *
 * Note: value is always received in mg/dL for color logic;
 * the `unit` prop drives the display label only.
 *
 * @see CLAUDE.md — §Design System, §Glycemia colors
 */

export interface AverageGlucoseWidgetProps extends WidgetProps {
  /** Glucose value in the chosen display unit */
  value: number
  /** Display unit label (e.g., "mg/dL", "g/L", "mmol/L") */
  unit: string
  /** Value in mg/dL for color classification. Defaults to `value` when unit is mg/dL. */
  valueMgdl?: number
}

function getColorClass(mgdl: number): string {
  if (mgdl <= 180) return "text-glycemia-normal"
  if (mgdl <= 250) return "text-glycemia-high"
  return "text-glycemia-very-high"
}

export function AverageGlucoseWidget({
  value,
  unit,
  valueMgdl,
  loading,
  onClick,
  className,
}: AverageGlucoseWidgetProps) {
  const t = useTranslations("metrics")

  if (loading) {
    return <WidgetSkeleton className={className} />
  }

  const mgdl = valueMgdl ?? value
  const colorClass = getColorClass(mgdl)
  const label = t("averageGlucose")

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
      aria-label={`${label}: ${value} ${unit}`}
    >
      <p className="text-xs text-gray-500 mb-1 font-medium truncate">{label}</p>
      <p className={cn("text-2xl font-bold leading-tight", colorClass)}>
        {value}
      </p>
      <p className="text-xs text-gray-400 mt-0.5">{unit}</p>
    </div>
  )
}
