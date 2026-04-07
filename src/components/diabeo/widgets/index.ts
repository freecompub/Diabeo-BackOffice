/**
 * DataSummaryGrid widget system — barrel exports
 *
 * Usage:
 *   import { DataSummaryGrid } from "@/components/diabeo/widgets"
 *   import type { WidgetData, WidgetType } from "@/components/diabeo/widgets"
 */

// Types
export type { WidgetType, WidgetData, WidgetProps } from "./types"

// Main grid
export { DataSummaryGrid } from "./DataSummaryGrid"
export type { DataSummaryGridProps } from "./DataSummaryGrid"

// Individual widgets
export { AverageGlucoseWidget } from "./AverageGlucoseWidget"
export type { AverageGlucoseWidgetProps } from "./AverageGlucoseWidget"

export { HbA1cWidget } from "./HbA1cWidget"
export type { HbA1cWidgetProps } from "./HbA1cWidget"

export { HypoglycemiaWidget } from "./HypoglycemiaWidget"
export type { HypoglycemiaWidgetProps } from "./HypoglycemiaWidget"

export { TimeInRangeWidget } from "./TimeInRangeWidget"
export type { TimeInRangeWidgetProps } from "./TimeInRangeWidget"

export { GlycemicVariabilityWidget } from "./GlycemicVariabilityWidget"
export type { GlycemicVariabilityWidgetProps } from "./GlycemicVariabilityWidget"

export { StandardDeviationWidget } from "./StandardDeviationWidget"
export type { StandardDeviationWidgetProps } from "./StandardDeviationWidget"

// Infrastructure
export { WidgetSkeleton } from "./WidgetSkeleton"
export { MetricEducationalPopover } from "./MetricEducationalPopover"
export type { MetricEducationalPopoverProps } from "./MetricEducationalPopover"
