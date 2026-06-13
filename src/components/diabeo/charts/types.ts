/**
 * Shared types for Diabeo chart components.
 * Used by GlycemiaEvolutionChart, ChartSummary, HypoglycemiaCounter, etc.
 */

import { GLYCEMIA_THRESHOLDS_MGDL as G } from "@/lib/glycemia-thresholds"

export interface GlucoseDataPoint {
  time: string
  timestamp: Date
  glucose: number
}

export interface InsulinDose {
  time: string
  timestamp: Date
  amount: number
  type: "bolus" | "basal"
}

export interface DiabetesEventMarker {
  time: string
  timestamp: Date
  eventType: string
  label: string
}

export interface GlycemiaThresholds {
  /** Below this: critical (immediate danger). Default: 40 mg/dL */
  criticalLow: number
  /** Below this: very-low (severe hypoglycemia). Default: 54 mg/dL */
  veryLow: number
  /** Below this: low (hypoglycemia). Default: 70 mg/dL */
  low: number
  targetMin: number
  targetMax: number
  high: number
  /** Above this: critical (immediate danger). Default: 400 mg/dL */
  criticalHigh: number
  veryHigh: number
}

// Dérivé de la source unique `glycemia-thresholds.ts` (par signification clinique).
export const DEFAULT_THRESHOLDS: GlycemiaThresholds = {
  criticalLow: G.CRITICAL_LOW,
  veryLow: G.SEVERE_HYPO,
  low: G.TARGET_LOW,
  targetMin: G.TARGET_LOW,
  targetMax: G.TARGET_HIGH,
  high: G.SEVERE_HYPER,
  veryHigh: G.CRITICAL_HIGH,
  criticalHigh: G.CRITICAL_HIGH,
}

export interface ChartDisplayOptions {
  showInsulin: boolean
  showEvents: boolean
  showThresholds: boolean
}

export interface ChartSummaryData {
  readingsCount: number
  averageGlucose: number
  dosesCount: number
}

export interface HypoglycemiaData {
  totalCount: number
  lastEventTime?: Date
  dailyCounts: { date: string; count: number }[]
}

export interface InsulinSummaryData {
  totalUnits: number
  basalUnits: number
  bolusUnits: number
  basalPercent: number
  bolusPercent: number
}

export interface TimeInRangeData {
  veryLow: number
  low: number
  inRange: number
  high: number
  veryHigh: number
}

export type GlucoseZone = "veryLow" | "low" | "inRange" | "high" | "veryHigh" | "critical"

/**
 * Classify a glucose value into a clinical zone.
 * Includes "critical" zone for values <40 or >400 mg/dL (immediate danger).
 *
 * Note: GlycemiaValue.tsx uses kebab-case zones ("very-low").
 * Chart components use camelCase zones ("veryLow").
 * Both follow the same clinical thresholds.
 */
export function getGlucoseZone(
  value: number,
  thresholds: GlycemiaThresholds = DEFAULT_THRESHOLDS
): GlucoseZone {
  if (value < thresholds.criticalLow || value > thresholds.criticalHigh) return "critical"
  if (value < thresholds.veryLow) return "veryLow"
  if (value < thresholds.low) return "low"
  if (value <= thresholds.targetMax) return "inRange"
  if (value <= thresholds.high) return "high"
  return "veryHigh"
}

export const ZONE_COLORS: Record<GlucoseZone, string> = {
  veryLow: "var(--color-glycemia-very-low)",
  low: "var(--color-glycemia-low)",
  inRange: "var(--color-glycemia-normal)",
  high: "var(--color-glycemia-high)",
  veryHigh: "var(--color-glycemia-very-high)",
  critical: "var(--color-glycemia-critical)",
}
