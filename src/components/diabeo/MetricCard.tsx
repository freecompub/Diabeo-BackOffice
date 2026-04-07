"use client"

import { forwardRef, type ReactNode } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { DiabeoCard } from "./DiabeoCard"

/**
 * MetricCard — Compact card for a single health or operational metric.
 *
 * Used in dashboard KPI sections to display aggregated data like
 * average TIR, HbA1c estimate, active patient counts, or alert counts.
 *
 * The left border color encodes status at a glance — critical alerts will
 * use red, normal ranges use green. This lets clinicians scan a row of
 * MetricCards rapidly without reading each label.
 *
 * Loading state shows Skeleton placeholders to prevent layout shift
 * while data is being fetched.
 */

export type MetricStatus = "normal" | "warning" | "critical" | "info"

export interface MetricTrend {
  /** Whether the value went up, down, or stayed stable */
  direction: "up" | "down" | "stable"
  /** Human-readable trend delta (e.g., "+2.3%", "-5 patients") */
  value: string
}

export interface MetricCardProps {
  /** Metric label (muted, small) */
  title: string
  /** Main value to display. Rendered large and bold. */
  value: string | number
  /** Unit suffix (e.g., "%", "mg/dL", "patients") */
  unit?: string
  /** Optional leading icon (Lucide or SVG element) */
  icon?: ReactNode
  /** Optional trend indicator shown below the value */
  trend?: MetricTrend
  /**
   * Status changes the left-border accent color.
   * - normal: green (#10B981)
   * - warning: amber (#F59E0B)
   * - critical: red (#EF4444)
   * - info: blue (#3B82F6)
   */
  status?: MetricStatus
  /** If provided, the card becomes clickable and calls this on activation */
  onClick?: () => void
  /** When true, replaces content with Skeleton placeholders */
  loading?: boolean
  /** Additional CSS classes */
  className?: string
}

// ─── Status → left border color mapping ──────────────────────────────────────

const statusBorderClasses: Record<MetricStatus, string> = {
  normal: "border-s-glycemia-normal",
  warning: "border-s-glycemia-high",
  critical: "border-s-glycemia-critical",
  info: "border-s-feedback-info",
}

// ─── Trend sub-component ──────────────────────────────────────────────────────

const trendDirectionClasses: Record<MetricTrend["direction"], string> = {
  up: "text-glycemia-normal",
  down: "text-glycemia-low",
  stable: "text-muted-foreground",
}

/** Paths for a minimal chevron/arrow icon per trend direction */
const trendIconPaths: Record<MetricTrend["direction"], string> = {
  up: "M5 15l7-7 7 7",
  down: "M19 9l-7 7-7-7",
  stable: "M5 12h14",
}

function TrendIndicator({ trend }: { trend: MetricTrend }) {
  const colorClass = trendDirectionClasses[trend.direction]
  const ariaLabel =
    trend.direction === "up"
      ? `En hausse de ${trend.value}`
      : trend.direction === "down"
        ? `En baisse de ${trend.value}`
        : `Stable, ${trend.value}`

  return (
    <div
      className={cn("flex items-center gap-0.5 text-xs font-medium", colorClass)}
      aria-label={ariaLabel}
    >
      <svg
        className="h-3.5 w-3.5"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={2.5}
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d={trendIconPaths[trend.direction]}
        />
      </svg>
      <span>{trend.value}</span>
    </div>
  )
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function MetricCardSkeleton() {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Chargement...">
      <Skeleton className="h-3.5 w-24" />
      <Skeleton className="h-8 w-16" />
      <Skeleton className="h-3 w-12" />
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * MetricCard displays a single KPI with optional status, trend, and icon.
 * Pass `loading={true}` while data is fetching to show skeleton placeholders.
 *
 * @example
 * <MetricCard
 *   title="Temps en cible"
 *   value={72}
 *   unit="%"
 *   status="normal"
 *   trend={{ direction: "up", value: "+3%" }}
 *   icon={<Activity className="h-4 w-4" />}
 * />
 */
export const MetricCard = forwardRef<HTMLDivElement, MetricCardProps>(
  function MetricCard(
    {
      title,
      value,
      unit,
      icon,
      trend,
      status,
      onClick,
      loading = false,
      className,
    },
    ref
  ) {
    const isClickable = !!onClick

    return (
      <DiabeoCard
        ref={ref}
        variant="elevated"
        padding="md"
        clickable={isClickable}
        onClick={onClick}
        className={cn(
          // Inline-start border accent when status is set
          status && "border-s-4",
          status && statusBorderClasses[status],
          className
        )}
        role={isClickable ? "button" : "region"}
        tabIndex={isClickable ? 0 : undefined}
        onKeyDown={
          isClickable
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  onClick?.()
                }
              }
            : undefined
        }
        aria-label={
          loading
            ? "Chargement de la metrique"
            : `${title}: ${value}${unit ? ` ${unit}` : ""}${trend ? `, ${trend.direction === "up" ? "en hausse" : trend.direction === "down" ? "en baisse" : "stable"} ${trend.value}` : ""}`
        }
      >
        {loading ? (
          <MetricCardSkeleton />
        ) : (
          <>
            {/* Top row: title + icon */}
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-medium text-muted-foreground truncate">
                {title}
              </p>
              {icon && (
                <span
                  className="shrink-0 text-muted-foreground/60"
                  aria-hidden="true"
                >
                  {icon}
                </span>
              )}
            </div>

            {/* Value row */}
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-2xl font-bold text-foreground tabular-nums">
                {value}
              </span>
              {unit && (
                <span className="text-sm text-muted-foreground">{unit}</span>
              )}
            </div>

            {/* Trend row */}
            {trend && (
              <div className="mt-2">
                <TrendIndicator trend={trend} />
              </div>
            )}
          </>
        )}
      </DiabeoCard>
    )
  }
)

MetricCard.displayName = "MetricCard"
