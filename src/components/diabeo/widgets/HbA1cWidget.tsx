"use client"

import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"
import { WidgetSkeleton } from "./WidgetSkeleton"
import type { WidgetProps } from "./types"

/**
 * HbA1c Widget
 *
 * Displays the estimated HbA1c percentage derived from CGM average glucose.
 *
 * Color thresholds (ADA guidelines):
 *   green  (< 7.0 %)   : well controlled
 *   amber  (7.0–8.5 %) : moderately controlled, discuss with care team
 *   red    (> 8.5 %)   : poorly controlled, action needed
 *
 * This value is estimated (eHbA1c) — not a laboratory result.
 * Always display with "estimated" qualifier in the UI.
 *
 * @see ADAG study formula: eHbA1c = (mean glucose [mg/dL] + 46.7) / 28.7
 */

export interface HbA1cWidgetProps extends WidgetProps {
  /** Estimated HbA1c percentage (e.g., 7.2) */
  value: number
}

function getColorClass(hba1c: number): string {
  if (hba1c < 7.0) return "text-glycemia-normal"
  if (hba1c <= 8.5) return "text-glycemia-high"
  return "text-glycemia-very-high"
}

export function HbA1cWidget({
  value,
  loading,
  onClick,
  className,
}: HbA1cWidgetProps) {
  const t = useTranslations("metrics")

  if (loading) {
    return <WidgetSkeleton className={className} />
  }

  const colorClass = getColorClass(value)
  const label = t("hba1c")

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
      aria-label={`${label}: ${value.toFixed(1)}%`}
    >
      <p className="text-xs text-gray-500 mb-1 font-medium truncate">{label}</p>
      <p className={cn("text-2xl font-bold leading-tight", colorClass)}>
        {value.toFixed(1)}
        <span className="text-sm font-medium ml-0.5">%</span>
      </p>
      <p className="text-xs text-gray-400 mt-0.5">estimé</p>
    </div>
  )
}
