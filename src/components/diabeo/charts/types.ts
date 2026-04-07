/**
 * Shared types for Diabeo chart components.
 * Used by GlycemiaEvolutionChart, ChartSummary, HypoglycemiaCounter, etc.
 */

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
  veryLow: number
  low: number
  targetMin: number
  targetMax: number
  high: number
  veryHigh: number
}

export const DEFAULT_THRESHOLDS: GlycemiaThresholds = {
  veryLow: 54,
  low: 70,
  targetMin: 70,
  targetMax: 180,
  high: 250,
  veryHigh: 400,
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

export type GlucoseZone = "veryLow" | "low" | "inRange" | "high" | "veryHigh"

export function getGlucoseZone(
  value: number,
  thresholds: GlycemiaThresholds = DEFAULT_THRESHOLDS
): GlucoseZone {
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
}
