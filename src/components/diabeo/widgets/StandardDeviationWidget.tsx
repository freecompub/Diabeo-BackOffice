"use client"

import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"
import { WidgetSkeleton } from "./WidgetSkeleton"
import type { WidgetProps } from "./types"

/**
 * Standard Deviation Widget
 *
 * Displays the standard deviation of glucose readings over the selected period.
 *
 * SD is unit-dependent (unlike CV). Values are shown with their display unit.
 *
 * Typical reference ranges (mg/dL):
 *   SD < 40 mg/dL is generally considered acceptable for T1D patients.
 *   SD > 60 mg/dL suggests significant glucose excursions.
 *
 * Note: No color coding here — SD alone without context of mean glucose
 * is not directly actionable. Use CV (GlycemicVariabilityWidget) for
 * color-coded variability assessment.
 *
 * @see GlycemicVariabilityWidget for the clinically preferred variability metric
 */

export interface StandardDeviationWidgetProps extends WidgetProps {
  /** Standard deviation value in the display unit */
  value: number
  /** Display unit (e.g., "mg/dL", "g/L") */
  unit: string
}

export function StandardDeviationWidget({
  value,
  unit,
  loading,
  onClick,
  className,
}: StandardDeviationWidgetProps) {
  const t = useTranslations("metrics")

  if (loading) {
    return <WidgetSkeleton className={className} />
  }

  const label = t("standardDeviation")

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
      <p className="text-2xl font-bold leading-tight text-gray-800">
        {value}
      </p>
      <p className="text-xs text-gray-400 mt-0.5">{unit}</p>
    </div>
  )
}
