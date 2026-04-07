"use client"

import { cn } from "@/lib/utils"
import { DiabeoCard } from "./DiabeoCard"
import { getGlycemiaZone, type GlycemiaZone } from "./GlycemiaValue"

/**
 * GlucoseCard — Specialized card for displaying a single glucose reading.
 *
 * Clinical context: Displays CGM or fingerstick values with:
 * - Zone-based color coding (international consensus thresholds: 54/70/180/250 mg/dL)
 * - CGM trend arrow when data is available
 * - Relative timestamp to reduce cognitive load
 * - Source device badge (Dexcom G7, FreeStyle Libre, etc.)
 *
 * IMPORTANT: Receives already-decrypted glucose values.
 * The parent is responsible for decryption and must not pass raw encrypted data.
 *
 * Uses "use client" only for relative time formatting — value display is pure.
 */

export type GlucoseTrend =
  | "rising_fast"
  | "rising"
  | "stable"
  | "falling"
  | "falling_fast"
  | "unknown"

export type GlucoseUnit = "mg/dL" | "g/L" | "mmol/L"

export interface GlucoseCardProps {
  /** Glucose value in mg/dL (internal unit — always stored as mg/dL) */
  value: number
  /** Display unit. The value prop is always in mg/dL and converted at render time. */
  unit?: GlucoseUnit
  /** CGM trend direction from device telemetry */
  trend?: GlucoseTrend
  /** Timestamp of the glucose measurement */
  timestamp?: Date
  /** Device source label (e.g., "Dexcom G7", "FreeStyle Libre 3") */
  source?: string
  /** Additional CSS classes */
  className?: string
}

// ─── Zone to Tailwind class mappings ─────────────────────────────────────────

const zoneTextClasses: Record<GlycemiaZone, string> = {
  "very-low": "text-glycemia-very-low",
  "low": "text-glycemia-low",
  "normal": "text-glycemia-normal",
  "high": "text-glycemia-high",
  "very-high": "text-glycemia-very-high",
  "critical": "text-glycemia-critical",
}

const zoneBgClasses: Record<GlycemiaZone, string> = {
  "very-low": "bg-glycemia-very-low-bg",
  "low": "bg-glycemia-low-bg",
  "normal": "bg-glycemia-normal-bg",
  "high": "bg-glycemia-high-bg",
  "very-high": "bg-glycemia-very-high-bg",
  "critical": "bg-glycemia-critical-bg",
}

const zoneLabelFr: Record<GlycemiaZone, string> = {
  "very-low": "Hypo severe",
  "low": "Hypoglycemie",
  "normal": "En cible",
  "high": "Hyperglycemie",
  "very-high": "Hyper severe",
  "critical": "Critique",
}

// ─── Trend arrow component ────────────────────────────────────────────────────

/** Aria labels for CGM trend directions — announced to screen readers */
const trendAriaLabels: Record<GlucoseTrend, string> = {
  rising_fast: "Montee rapide",
  rising: "En hausse",
  stable: "Stable",
  falling: "En baisse",
  falling_fast: "Descente rapide",
  unknown: "Tendance inconnue",
}

function TrendArrow({ trend }: { trend: GlucoseTrend }) {
  const arrows: Record<GlucoseTrend, string> = {
    rising_fast: "↑↑",
    rising: "↗",
    stable: "→",
    falling: "↘",
    falling_fast: "↓↓",
    unknown: "?",
  }

  const colorClasses: Record<GlucoseTrend, string> = {
    rising_fast: "text-glycemia-very-high",
    rising: "text-glycemia-high",
    stable: "text-glycemia-normal",
    falling: "text-glycemia-high",
    falling_fast: "text-glycemia-low",
    unknown: "text-muted-foreground",
  }

  return (
    <span
      aria-label={trendAriaLabels[trend]}
      className={cn("text-2xl font-bold leading-none", colorClasses[trend])}
    >
      {arrows[trend]}
    </span>
  )
}

// ─── Unit conversion ──────────────────────────────────────────────────────────

function convertGlucose(mgdl: number, unit: GlucoseUnit): string {
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

// ─── Relative time formatting ─────────────────────────────────────────────────

function formatRelativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)

  if (diffMins < 1) return "A l'instant"
  if (diffMins < 60) return `Il y a ${diffMins} min`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `Il y a ${diffHours}h`
  const diffDays = Math.floor(diffHours / 24)
  return diffDays === 1 ? "Hier" : `Il y a ${diffDays}j`
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Displays a glucose reading with clinical color-coding, trend arrow,
 * relative timestamp, and optional device source badge.
 *
 * @example
 * <GlucoseCard
 *   value={142}
 *   unit="mg/dL"
 *   trend="rising"
 *   timestamp={new Date(Date.now() - 5 * 60 * 1000)}
 *   source="Dexcom G7"
 * />
 */
export function GlucoseCard({
  value,
  unit = "mg/dL",
  trend,
  timestamp,
  source,
  className,
}: GlucoseCardProps) {
  const zone = getGlycemiaZone(value)
  const displayValue = convertGlucose(value, unit)
  const isCritical = zone === "critical" || zone === "very-low"

  return (
    <DiabeoCard
      variant="elevated"
      padding="md"
      className={cn(
        "relative overflow-hidden",
        isCritical && "animate-clinical-pulse",
        className
      )}
      role={isCritical ? "alert" : "region"}
      aria-label={`Glycemie ${displayValue} ${unit}, ${zoneLabelFr[zone]}${trend ? `, ${trendAriaLabels[trend]}` : ""}${timestamp ? `, mesure ${formatRelativeTime(timestamp)}` : ""}`}
    >
      {/* Zone color accent strip on the left edge */}
      <div
        className={cn("absolute inset-y-0 start-0 w-1", zoneBgClasses[zone])}
        aria-hidden="true"
      />

      <div className="ps-3">
        {/* Zone label */}
        <p className="text-xs font-medium text-muted-foreground mb-1">
          {zoneLabelFr[zone]}
        </p>

        {/* Primary value row: value + trend arrow */}
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              "text-4xl font-bold tabular-nums tracking-tight",
              zoneTextClasses[zone]
            )}
          >
            {displayValue}
          </span>
          <span className="text-sm font-normal text-muted-foreground">
            {unit}
          </span>
          {trend && trend !== "unknown" && (
            <span className="ms-1 self-center">
              <TrendArrow trend={trend} />
            </span>
          )}
        </div>

        {/* Footer row: timestamp left, source badge right */}
        {(timestamp || source) && (
          <div className="flex items-center justify-between mt-2 gap-2">
            {timestamp && (
              <time
                dateTime={timestamp.toISOString()}
                className="text-xs text-muted-foreground"
              >
                {formatRelativeTime(timestamp)}
              </time>
            )}
            {source && (
              <span className="ms-auto text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                {source}
              </span>
            )}
          </div>
        )}
      </div>
    </DiabeoCard>
  )
}
