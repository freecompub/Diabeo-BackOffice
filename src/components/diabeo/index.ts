/**
 * Diabeo Design System — Component Exports
 *
 * All medical-grade UI components for the Diabeo BackOffice.
 * Built on shadcn/ui with the "Serenite Active" palette.
 *
 * Usage:
 *   import { GlycemiaValue, PatientCard, DiabeoButton } from "@/components/diabeo"
 */

// --- Phase 8 components (existing) ---

export { GlycemiaValue, getGlycemiaZone } from "./GlycemiaValue"
export type {
  GlycemiaValueProps,
  GlycemiaZone,
  GlycemiaThresholds,
} from "./GlycemiaValue"

export { TirDonut } from "./TirDonut"
export type { TirDonutProps, TirData } from "./TirDonut"

export { AlertBanner } from "./AlertBanner"
export type { AlertBannerProps, AlertSeverity } from "./AlertBanner"

export { PatientCard } from "./PatientCard"
export type { PatientCardProps } from "./PatientCard"

export { StatCard } from "./StatCard"
export type { StatCardProps, TrendDirection } from "./StatCard"

export { CgmChart } from "./CgmChart"

export { Sidebar } from "./Sidebar"

export { DashboardHeader } from "./DashboardHeader"

export { ClinicalBadge } from "./ClinicalBadge"
export type {
  ClinicalBadgeProps,
  Pathology,
  QualityLevel,
  BadgeType,
} from "./ClinicalBadge"

// --- Phase 11 — Atoms (US-WEB-100b) ---

export { DiabeoText } from "./DiabeoText"
export { DiabeoIcon } from "./DiabeoIcon"
export { GlucoseBadge } from "./GlucoseBadge"
export { TrendIndicator } from "./TrendIndicator"
export { MetricLabel } from "./MetricLabel"

// --- Phase 11 — Molecules (US-WEB-100c) ---

export { DiabeoButton } from "./DiabeoButton"
export { DiabeoTextField } from "./DiabeoTextField"
export { DiabeoToggle } from "./DiabeoToggle"
export { DiabeoFormSection } from "./DiabeoFormSection"
export { DiabeoReadonlyField } from "./DiabeoReadonlyField"

// --- Phase 11 — Organisms (US-WEB-100d) ---

export { DiabeoCard } from "./DiabeoCard"
export { GlucoseCard } from "./GlucoseCard"
export { MetricCard } from "./MetricCard"
export { DiabeoEmptyState } from "./DiabeoEmptyState"
export { DiabeoFAB } from "./DiabeoFAB"

// --- Phase 11 — PeriodSelector (US-WEB-102) ---

export { PeriodSelector } from "./PeriodSelector"

// --- Phase 11 — Navigation Shell (US-WEB-104) ---

export { NavigationShell } from "./NavigationShell"
export type { NavigationShellProps, BreadcrumbItem, UserRole } from "./NavigationShell"

// --- Phase 11 — DataSummaryGrid (US-WEB-103) ---

export {
  DataSummaryGrid,
  AverageGlucoseWidget,
  HbA1cWidget,
  HypoglycemiaWidget,
  TimeInRangeWidget,
  GlycemicVariabilityWidget,
  StandardDeviationWidget,
  WidgetSkeleton,
  MetricEducationalPopover,
} from "./widgets"
export type {
  WidgetType,
  WidgetData,
  WidgetProps,
  DataSummaryGridProps,
  AverageGlucoseWidgetProps,
  HbA1cWidgetProps,
  HypoglycemiaWidgetProps,
  TimeInRangeWidgetProps,
  GlycemicVariabilityWidgetProps,
  StandardDeviationWidgetProps,
  MetricEducationalPopoverProps,
} from "./widgets"
