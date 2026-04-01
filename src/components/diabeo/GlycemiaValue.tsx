"use client"

import { cn } from "@/lib/utils"

/**
 * Glycemia zone classification based on international consensus.
 * Default thresholds (mg/dL):
 *   very-low: <54 | low: 54-69 | normal: 70-180 | high: 181-250 | very-high: >250
 *
 * These thresholds can be overridden per-patient via GlucoseTarget config.
 */
export type GlycemiaZone =
  | "very-low"
  | "low"
  | "normal"
  | "high"
  | "very-high"
  | "critical"

export interface GlycemiaThresholds {
  /** Below this value: very-low (severe hypoglycemia). Default: 54 */
  veryLow?: number
  /** Below this value: low (hypoglycemia). Default: 70 */
  low?: number
  /** Above this value: high (hyperglycemia). Default: 180 */
  high?: number
  /** Above this value: very-high (severe hyperglycemia). Default: 250 */
  veryHigh?: number
  /** Above this value: critical (immediate danger). Default: 400 */
  critical?: number
}

export interface GlycemiaValueProps {
  /** Glucose value in mg/dL */
  value: number
  /** Unit to display. Defaults to "mg/dL" */
  unit?: "mg/dL" | "g/L" | "mmol/L"
  /** Custom thresholds override per-patient config */
  thresholds?: GlycemiaThresholds
  /** Size variant */
  size?: "sm" | "md" | "lg" | "xl"
  /** Show the unit label */
  showUnit?: boolean
  /** Show the zone label (e.g., "Normal", "Hypo") */
  showZoneLabel?: boolean
  /** Additional CSS classes */
  className?: string
  /** Whether to show the colored background pill */
  showBackground?: boolean
}

const DEFAULT_THRESHOLDS: Required<GlycemiaThresholds> = {
  veryLow: 54,
  low: 70,
  high: 180,
  veryHigh: 250,
  critical: 400,
}

const ZONE_LABELS: Record<GlycemiaZone, string> = {
  "very-low": "Hypo severe",
  "low": "Hypo",
  "normal": "Normal",
  "high": "Hyper",
  "very-high": "Hyper severe",
  "critical": "Critique",
}

const ZONE_ARIA_LABELS: Record<GlycemiaZone, string> = {
  "very-low": "Hypoglycemie severe",
  "low": "Hypoglycemie",
  "normal": "Glycemie normale",
  "high": "Hyperglycemie",
  "very-high": "Hyperglycemie severe",
  "critical": "Glycemie critique, intervention requise",
}

export function getGlycemiaZone(
  value: number,
  thresholds?: GlycemiaThresholds
): GlycemiaZone {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds }

  if (value > t.critical) return "critical"
  if (value > t.veryHigh) return "very-high"
  if (value > t.high) return "high"
  if (value >= t.low) return "normal"
  if (value >= t.veryLow) return "low"
  if (value < t.veryLow) return "very-low"

  return "normal"
}

/** Convert mg/dL to display value in the selected unit */
function convertValue(mgdl: number, unit: "mg/dL" | "g/L" | "mmol/L"): string {
  switch (unit) {
    case "g/L":
      return (mgdl / 100).toFixed(2)
    case "mmol/L":
      return (mgdl / 18.0182).toFixed(1)
    case "mg/dL":
    default:
      return Math.round(mgdl).toString()
  }
}

const sizeClasses = {
  sm: "text-sm font-medium",
  md: "text-base font-semibold",
  lg: "text-xl font-bold",
  xl: "text-3xl font-bold tracking-tight",
} as const

const zoneColorClasses: Record<GlycemiaZone, string> = {
  "very-low": "text-glycemia-very-low",
  "low": "text-glycemia-low",
  "normal": "text-glycemia-normal",
  "high": "text-glycemia-high",
  "very-high": "text-glycemia-very-high",
  "critical": "text-glycemia-critical",
}

const zoneBgClasses: Record<GlycemiaZone, string> = {
  "very-low": "bg-glycemia-very-low-bg border border-glycemia-very-low/20",
  "low": "bg-glycemia-low-bg border border-glycemia-low/20",
  "normal": "bg-glycemia-normal-bg border border-glycemia-normal/20",
  "high": "bg-glycemia-high-bg border border-glycemia-high/20",
  "very-high": "bg-glycemia-very-high-bg border border-glycemia-very-high/20",
  "critical": "bg-glycemia-critical-bg border border-glycemia-critical/20 animate-clinical-pulse",
}

/**
 * GlycemiaValue — Displays a glucose value with clinical color coding.
 *
 * Color zones follow international diabetes consensus:
 * - Green: in range (70-180 mg/dL)
 * - Amber: elevated (181-250 mg/dL)
 * - Red: hypo (<70) or hyper severe (>250)
 * - Dark red: critical (<54 or >400)
 *
 * Accessibility: uses aria-label to announce the clinical zone
 * for screen reader users, ensuring alerts are communicated.
 */
export function GlycemiaValue({
  value,
  unit = "mg/dL",
  thresholds,
  size = "md",
  showUnit = true,
  showZoneLabel = false,
  showBackground = false,
  className,
}: GlycemiaValueProps) {
  const zone = getGlycemiaZone(value, thresholds)
  const displayValue = convertValue(value, unit)
  const ariaLabel = `${displayValue} ${unit}, ${ZONE_ARIA_LABELS[zone]}`
  const isCritical = zone === "critical" || zone === "very-low"

  return (
    <span
      role={isCritical ? "alert" : undefined}
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-baseline gap-1",
        showBackground && "rounded-md px-2 py-0.5",
        showBackground && zoneBgClasses[zone],
        className
      )}
    >
      <span
        className={cn(
          sizeClasses[size],
          zoneColorClasses[zone],
          "tabular-nums"
        )}
      >
        {displayValue}
      </span>
      {showUnit && (
        <span className="text-muted-foreground text-xs font-normal">
          {unit}
        </span>
      )}
      {showZoneLabel && (
        <span
          className={cn(
            "ml-1 text-xs font-medium",
            zoneColorClasses[zone]
          )}
        >
          {ZONE_LABELS[zone]}
        </span>
      )}
    </span>
  )
}
