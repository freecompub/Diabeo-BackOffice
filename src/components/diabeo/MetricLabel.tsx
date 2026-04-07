import { forwardRef, type HTMLAttributes } from "react"
import { cn } from "@/lib/utils"
import { type GlycemiaZone } from "./GlycemiaValue"

/**
 * MetricLabel — Compact metric display with a label above and value below.
 *
 * Designed for dashboard widgets, stat cards, and clinical summary panels
 * where a labeled numeric or textual metric must be readable at a glance.
 *
 * Layout:
 *   ┌─────────────────────┐
 *   │ label (muted, small)│
 *   │ value  unit         │
 *   └─────────────────────┘
 *
 * The `color` prop maps to glycemia zone colors from the design system,
 * enabling direct integration with clinical glucose data.
 *
 * Accessibility:
 * - Renders as a `<dl>` (description list) — semantically correct for
 *   key-value pairs in medical dashboards.
 * - `aria-label` on the wrapping element combines label + value + unit
 *   for screen reader announcements.
 *
 * @example
 * // Basic metric
 * <MetricLabel label="Glycemie moyenne" value={142} unit="mg/dL" />
 *
 * @example
 * // With glycemia zone color
 * <MetricLabel label="TIR" value="78%" color="normal" size="lg" />
 *
 * @example
 * // Small variant for compact panels
 * <MetricLabel label="Bolus" value={3.5} unit="U" size="sm" />
 */

// ---------------------------------------------------------------------------
// Size variants
// ---------------------------------------------------------------------------

interface SizeConfig {
  label: string
  value: string
  unit: string
  gap: string
}

const SIZE_CONFIG: Record<MetricLabelSize, SizeConfig> = {
  sm: {
    label: "text-xs font-normal",
    value: "text-base font-bold tabular-nums",
    unit:  "text-xs font-normal ms-0.5",
    gap:   "gap-0",
  },
  md: {
    label: "text-sm font-normal",
    value: "text-xl font-bold tabular-nums",
    unit:  "text-sm font-normal ms-1",
    gap:   "gap-0.5",
  },
  lg: {
    label: "text-base font-normal",
    value: "text-2xl font-bold tabular-nums",
    unit:  "text-base font-normal ms-1",
    gap:   "gap-1",
  },
}

export type MetricLabelSize = "sm" | "md" | "lg"

// ---------------------------------------------------------------------------
// Glycemia zone → value color class
// ---------------------------------------------------------------------------

const ZONE_COLOR: Record<GlycemiaZone, string> = {
  "very-low": "text-glycemia-very-low",
  "low":      "text-glycemia-low",
  "normal":   "text-glycemia-normal",
  "high":     "text-glycemia-high",
  "very-high":"text-glycemia-very-high",
  "critical": "text-glycemia-critical",
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MetricLabelProps
  extends Omit<HTMLAttributes<HTMLDListElement>, "children" | "color"> {
  /** Descriptive label rendered above the value */
  label: string
  /** Metric value — number or pre-formatted string */
  value: string | number
  /** Optional unit suffix (e.g., "mg/dL", "U", "%") */
  unit?: string
  /** Optional glycemia zone for clinical color coding of the value */
  color?: GlycemiaZone
  /** Size variant. Defaults to "md" */
  size?: MetricLabelSize
  /** Additional CSS classes */
  className?: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const MetricLabel = forwardRef<HTMLDListElement, MetricLabelProps>(
  function MetricLabel(
    { label, value, unit, color, size = "md", className, ...props },
    ref
  ) {
    const sizeConfig = SIZE_CONFIG[size]
    const valueColorClass = color ? ZONE_COLOR[color] : "text-foreground"

    // Compose accessible announcement: "label: value unit"
    const ariaLabel = [label, String(value), unit].filter(Boolean).join(" ")

    return (
      <dl
        ref={ref}
        aria-label={ariaLabel}
        className={cn(
          "flex flex-col",
          sizeConfig.gap,
          className
        )}
        {...props}
      >
        {/* Label row */}
        <dt
          className={cn(
            sizeConfig.label,
            "text-muted-foreground leading-none"
          )}
        >
          {label}
        </dt>

        {/* Value + Unit row */}
        <dd className="flex items-baseline m-0 leading-none">
          <span
            className={cn(
              sizeConfig.value,
              valueColorClass,
              "leading-none"
            )}
          >
            {value}
          </span>
          {unit && (
            <span
              className={cn(
                sizeConfig.unit,
                "text-muted-foreground leading-none"
              )}
              aria-hidden="true"
            >
              {unit}
            </span>
          )}
        </dd>
      </dl>
    )
  }
)

MetricLabel.displayName = "MetricLabel"

export type { GlycemiaZone }
