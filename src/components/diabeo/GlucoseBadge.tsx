"use client"

import { forwardRef, type HTMLAttributes } from "react"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import {
  getGlycemiaZone,
  type GlycemiaZone,
  type GlycemiaThresholds,
} from "./GlycemiaValue"

/**
 * GlucoseBadge — Pill badge displaying a glucose value with clinical color coding.
 *
 * Uses `getGlycemiaZone` from GlycemiaValue to determine the clinical zone
 * (very-low, low, normal, high, very-high, critical) and applies the
 * corresponding Diabeo glycemia design tokens.
 *
 * The input `value` must always be in mg/dL. Display is converted per `unit`.
 *
 * Accessibility:
 * - `aria-label` announces value, unit, and clinical zone name via i18n
 * - Critical zones (very-low, critical) use `role="alert"` for immediate
 *   announcement by screen readers — matches clinical urgency.
 *
 * @example
 * // Default mg/dL
 * <GlucoseBadge value={85} unit="mg/dL" />
 *
 * @example
 * // With custom thresholds (patient-specific)
 * <GlucoseBadge value={180} unit="mmol/L" thresholds={{ high: 160 }} />
 */

// ---------------------------------------------------------------------------
// Unit conversion
// ---------------------------------------------------------------------------

function convertValue(mgdl: number, unit: GlucoseUnit): string {
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

export type GlucoseUnit = "mg/dL" | "g/L" | "mmol/L"

// ---------------------------------------------------------------------------
// Zone-to-Tailwind class maps (reference design tokens from globals.css)
// ---------------------------------------------------------------------------

const ZONE_BG: Record<GlycemiaZone, string> = {
  "very-low": "bg-glycemia-very-low-bg text-glycemia-very-low border border-glycemia-very-low/30",
  "low":      "bg-glycemia-low-bg text-glycemia-low border border-glycemia-low/30",
  "normal":   "bg-glycemia-normal-bg text-glycemia-normal border border-glycemia-normal/30",
  "high":     "bg-glycemia-high-bg text-glycemia-high border border-glycemia-high/30",
  "very-high":"bg-glycemia-very-high-bg text-glycemia-very-high border border-glycemia-very-high/30",
  "critical": "bg-glycemia-critical-bg text-glycemia-critical border border-glycemia-critical/30 animate-clinical-pulse",
}

/** Maps GlycemiaZone values to i18n keys under glycemia.zone namespace */
const ZONE_I18N_KEY: Record<GlycemiaZone, string> = {
  "very-low": "veryLow",
  "low":      "low",
  "normal":   "normal",
  "high":     "high",
  "very-high":"veryHigh",
  "critical": "critical",
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GlucoseBadgeProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  /** Glucose value in mg/dL (always). Displayed value is converted per `unit`. */
  value: number
  /** Display unit. Defaults to "mg/dL" */
  unit?: GlucoseUnit
  /** Optional per-patient threshold overrides */
  thresholds?: GlycemiaThresholds
  /** Additional CSS classes */
  className?: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const GlucoseBadge = forwardRef<HTMLSpanElement, GlucoseBadgeProps>(
  function GlucoseBadge(
    { value, unit = "mg/dL", thresholds, className, ...props },
    ref
  ) {
    const tZone = useTranslations("glycemia.zone")
    const zone = getGlycemiaZone(value, thresholds)
    const displayValue = convertValue(value, unit)
    const isCritical = zone === "critical" || zone === "very-low"
    const zoneLabel = tZone(ZONE_I18N_KEY[zone] as Parameters<typeof tZone>[0])
    const label = `${displayValue} ${unit}, ${zoneLabel}`

    return (
      <span
        ref={ref}
        role={isCritical ? "alert" : undefined}
        aria-label={label}
        className={cn(
          // Pill shape
          "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5",
          // Typography
          "text-xs font-semibold tabular-nums whitespace-nowrap",
          // Zone color (bg + text + border)
          ZONE_BG[zone],
          className
        )}
        {...props}
      >
        <span aria-hidden="true">
          {displayValue}
          <span className="ms-0.5 font-normal opacity-75">{unit}</span>
        </span>
      </span>
    )
  }
)

GlucoseBadge.displayName = "GlucoseBadge"

export type { GlycemiaZone, GlycemiaThresholds }
