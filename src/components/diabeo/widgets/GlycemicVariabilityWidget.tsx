"use client"

import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"
import { WidgetSkeleton } from "./WidgetSkeleton"
import type { WidgetProps } from "./types"

/**
 * Glycemic Variability Widget — Coefficient of Variation (CV)
 *
 * The CV is the ratio of the standard deviation to the mean glucose,
 * expressed as a percentage. It is unit-independent.
 *
 * Stability thresholds (Danne et al., Diabetes Care 2017):
 *   Stable   : CV < 36 %   — low variability, good control
 *   Moderate : CV 36–50 %  — moderate variability, monitor closely
 *   Unstable : CV > 50 %   — high variability, therapy review recommended
 *
 * CLINICAL RISK: High CV correlates with increased hypoglycemia risk
 * even when mean glucose appears normal.
 */

export interface GlycemicVariabilityWidgetProps extends WidgetProps {
  /** Coefficient of variation as a percentage (e.g., 32.5) */
  value: number
}

type StabilityLevel = "stable" | "moderate" | "unstable"

function getStability(cv: number): StabilityLevel {
  if (cv < 36) return "stable"
  if (cv <= 50) return "moderate"
  return "unstable"
}

const STABILITY_CONFIG: Record<
  StabilityLevel,
  { colorClass: string; label: string }
> = {
  stable: { colorClass: "text-glycemia-normal", label: "Stable" },
  moderate: { colorClass: "text-glycemia-high", label: "Modéré" },
  unstable: { colorClass: "text-glycemia-low", label: "Instable" },
}

export function GlycemicVariabilityWidget({
  value,
  loading,
  onClick,
  className,
}: GlycemicVariabilityWidgetProps) {
  const t = useTranslations("metrics")

  if (loading) {
    return <WidgetSkeleton className={className} />
  }

  const stability = getStability(value)
  const { colorClass, label: stabilityLabel } = STABILITY_CONFIG[stability]
  const metricLabel = t("cv")

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
      aria-label={`${metricLabel}: ${value.toFixed(1)}% — ${stabilityLabel}`}
    >
      <p className="text-xs text-gray-500 mb-1 font-medium truncate">{metricLabel}</p>
      <p className={cn("text-2xl font-bold leading-tight", colorClass)}>
        {value.toFixed(1)}
        <span className="text-sm font-medium ml-0.5">%</span>
      </p>
      <p className={cn("text-xs mt-0.5 font-medium", colorClass)}>
        {stabilityLabel}
      </p>
    </div>
  )
}
