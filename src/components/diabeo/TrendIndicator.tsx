import { forwardRef, type HTMLAttributes } from "react"
import {
  ArrowUp,
  ArrowUpRight,
  ArrowRight,
  ArrowDownRight,
  ArrowDown,
  Minus,
} from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * TrendIndicator — Glucose trend arrow with clinical color coding.
 *
 * Visualises the CGM (Continuous Glucose Monitor) trend arrow as a directional
 * icon with a color that reflects the clinical significance of the trend rate.
 *
 * Trend semantics (standard CGM convention):
 *   rising_fast  — >2 mg/dL/min — alert red
 *   rising       — 1-2 mg/dL/min — orange
 *   stable       — ±1 mg/dL/min — green (in-range)
 *   falling      — 1-2 mg/dL/min drop — orange
 *   falling_fast — >2 mg/dL/min drop — alert red
 *   unknown      — sensor gap, calibration — muted gray
 *
 * Accessibility:
 * - Provides a descriptive `aria-label` in French for screen readers.
 * - The SVG icon itself is aria-hidden; the wrapper carries the label.
 *
 * RTL support: the icon rotates to convey direction, not side. No flip needed.
 *
 * @example
 * <TrendIndicator trend="rising_fast" />
 * <TrendIndicator trend="stable" className="ml-1" />
 */

// ---------------------------------------------------------------------------
// Trend config
// ---------------------------------------------------------------------------

export type GlucoseTrend =
  | "rising_fast"
  | "rising"
  | "stable"
  | "falling"
  | "falling_fast"
  | "unknown"

interface TrendConfig {
  /** Lucide icon component */
  icon: React.ElementType
  /** Tailwind color class */
  colorClass: string
  /** French aria-label */
  ariaLabel: string
}

const TREND_CONFIG: Record<GlucoseTrend, TrendConfig> = {
  rising_fast: {
    icon: ArrowUp,
    colorClass: "text-feedback-error",
    ariaLabel: "Glycemie en hausse rapide",
  },
  rising: {
    icon: ArrowUpRight,
    colorClass: "text-feedback-warning",
    ariaLabel: "Glycemie en hausse",
  },
  stable: {
    icon: ArrowRight,
    colorClass: "text-feedback-success",
    ariaLabel: "Glycemie stable",
  },
  falling: {
    icon: ArrowDownRight,
    colorClass: "text-feedback-warning",
    ariaLabel: "Glycemie en baisse",
  },
  falling_fast: {
    icon: ArrowDown,
    colorClass: "text-feedback-error",
    ariaLabel: "Glycemie en baisse rapide",
  },
  unknown: {
    icon: Minus,
    colorClass: "text-muted-foreground",
    ariaLabel: "Tendance inconnue",
  },
}

// ---------------------------------------------------------------------------
// Size mapping (matches DiabeoIcon for composability)
// ---------------------------------------------------------------------------

const SIZE_PX = {
  sm: 14,
  md: 18,
  lg: 22,
} as const

type TrendSize = keyof typeof SIZE_PX

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrendIndicatorProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  /** CGM trend direction */
  trend: GlucoseTrend
  /** Icon size variant. Defaults to "md" */
  size?: TrendSize
  /** Additional CSS classes */
  className?: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const TrendIndicator = forwardRef<HTMLSpanElement, TrendIndicatorProps>(
  function TrendIndicator({ trend, size = "md", className, ...props }, ref) {
    const { icon: Icon, colorClass, ariaLabel } = TREND_CONFIG[trend]
    const px = SIZE_PX[size]
    const isCritical = trend === "rising_fast" || trend === "falling_fast"

    return (
      <span
        ref={ref}
        role={isCritical ? "alert" : "img"}
        aria-label={ariaLabel}
        className={cn("inline-flex items-center justify-center", className)}
        {...props}
      >
        <Icon
          width={px}
          height={px}
          aria-hidden="true"
          className={cn("shrink-0", colorClass)}
          strokeWidth={2.5}
        />
      </span>
    )
  }
)

TrendIndicator.displayName = "TrendIndicator"

export { TREND_CONFIG, SIZE_PX as TREND_SIZE_PX }
