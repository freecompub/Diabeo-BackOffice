"use client"

import { cn } from "@/lib/utils"

export type TrendDirection = "up" | "down" | "stable"

export interface StatCardProps {
  /** Main label describing the metric */
  label: string
  /** Primary value to display */
  value: string | number
  /** Unit suffix (e.g., "mg/dL", "%", "U") */
  unit?: string
  /** Trend direction arrow */
  trend?: TrendDirection
  /** Trend percentage or description */
  trendValue?: string
  /** Whether the trend direction is positive (green) or negative (red).
   *  For glucose: down can be good. For TIR: up is good. */
  trendIsPositive?: boolean
  /** Icon element to display (Lucide icon or SVG) */
  icon?: React.ReactNode
  /** Variant changes the left border accent color */
  variant?: "default" | "teal" | "success" | "warning" | "critical"
  /** Additional CSS classes */
  className?: string
}

const variantBorderClasses: Record<
  NonNullable<StatCardProps["variant"]>,
  string
> = {
  default: "border-l-border",
  teal: "border-l-teal-600",
  success: "border-l-glycemia-normal",
  warning: "border-l-glycemia-high",
  critical: "border-l-glycemia-critical",
}

function TrendIcon({ direction }: { direction: TrendDirection }) {
  const paths: Record<TrendDirection, string> = {
    up: "M5 15l7-7 7 7",
    down: "M19 9l-7 7-7-7",
    stable: "M5 12h14",
  }

  return (
    <svg
      className="h-3.5 w-3.5"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2.5}
      stroke="currentColor"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d={paths[direction]} />
    </svg>
  )
}

/**
 * StatCard — Metric display card for dashboards.
 *
 * Shows a single metric with optional trend indicator.
 * Designed for data-dense dashboard layouts used by
 * healthcare professionals monitoring patient cohorts.
 *
 * The left border accent color provides quick visual categorization
 * without requiring the user to read the label.
 */
export function StatCard({
  label,
  value,
  unit,
  trend,
  trendValue,
  trendIsPositive,
  icon,
  variant = "default",
  className,
}: StatCardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border border-l-4 bg-card p-4",
        "shadow-diabeo-xs",
        variantBorderClasses[variant],
        className
      )}
      role="group"
      aria-label={`${label}: ${value}${unit ? ` ${unit}` : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-muted-foreground truncate">
            {label}
          </p>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-2xl font-bold text-foreground tabular-nums">
              {value}
            </span>
            {unit && (
              <span className="text-sm text-muted-foreground">{unit}</span>
            )}
          </div>
        </div>
        {icon && (
          <div
            className="shrink-0 text-muted-foreground/60"
            aria-hidden="true"
          >
            {icon}
          </div>
        )}
      </div>

      {/* Trend indicator */}
      {trend && (
        <div className="mt-2 flex items-center gap-1">
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-xs font-medium",
              trendIsPositive !== undefined
                ? trendIsPositive
                  ? "text-glycemia-normal"
                  : "text-glycemia-low"
                : "text-muted-foreground"
            )}
          >
            <TrendIcon direction={trend} />
            {trendValue}
          </span>
        </div>
      )}
    </div>
  )
}
