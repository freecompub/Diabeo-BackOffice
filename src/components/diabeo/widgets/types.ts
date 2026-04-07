/**
 * Shared types for the DataSummaryGrid widget system.
 *
 * Each WidgetType maps to one clinical metric from the CGM/glucose dataset.
 * WidgetData holds optional per-metric payloads; absent keys mean "no data available".
 *
 * Clinical references:
 *   - TIR target >= 70 % (International Consensus, Diabetes Care 2019)
 *   - CV < 36 % for glycemic stability (Danne et al., Diabetes Care 2017)
 *   - eHbA1c derived from CGM average (ADAG study formula)
 */

export type WidgetType =
  | "averageGlucose"
  | "hba1c"
  | "hypoglycemia"
  | "timeInRange"
  | "glycemicVariability"
  | "standardDeviation"

export interface WidgetData {
  averageGlucose?: { value: number; unit: string }
  hba1c?: { value: number }
  hypoglycemia?: { count: number; lastEvent?: Date }
  timeInRange?: {
    inRange: number
    low: number
    veryLow: number
    high: number
    veryHigh: number
    readingCount?: number
  }
  cv?: { value: number }
  standardDeviation?: { value: number; unit: string }
}

export interface WidgetProps {
  /** Additional CSS classes forwarded to the root element */
  className?: string
  /** Shows skeleton placeholders while data is loading */
  loading?: boolean
  /** Makes the widget interactive — adds role="button", keyboard handler, hover state */
  onClick?: () => void
}
