/**
 * Diabeo Charts — Component Exports
 *
 * Chart components for glucose data visualization.
 * Built on Recharts with Diabeo design tokens.
 */

export { GlycemiaEvolutionChart } from "./GlycemiaEvolutionChart"
export { ChartSummary } from "./ChartSummary"
export { ChartDisplayOptionsMenu } from "./ChartDisplayOptionsMenu"
export { HypoglycemiaCounter } from "./HypoglycemiaCounter"
export { InsulinSummary } from "./InsulinSummary"
export { TimeInRangeChart } from "./TimeInRangeChart"

export type {
  GlucoseDataPoint,
  InsulinDose,
  DiabetesEventMarker,
  GlycemiaThresholds,
  ChartDisplayOptions,
  ChartSummaryData,
  HypoglycemiaData,
  InsulinSummaryData,
  TimeInRangeData,
  GlucoseZone,
} from "./types"

export { DEFAULT_THRESHOLDS, getGlucoseZone, ZONE_COLORS } from "./types"
