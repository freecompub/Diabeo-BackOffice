/**
 * Diabeo Design System — Component Exports
 *
 * All medical-grade UI components for the Diabeo BackOffice.
 * Built on shadcn/ui with the "Serenite Active" palette.
 *
 * Usage:
 *   import { GlycemiaValue, PatientCard } from "@/components/diabeo"
 */

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

export { ClinicalBadge } from "./ClinicalBadge"
export type {
  ClinicalBadgeProps,
  Pathology,
  QualityLevel,
  BadgeType,
} from "./ClinicalBadge"
