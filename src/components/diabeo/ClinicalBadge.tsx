"use client"

import { cn } from "@/lib/utils"

export type Pathology = "DT1" | "DT2" | "GD"
export type QualityLevel = "excellent" | "good" | "moderate" | "poor"

export type BadgeType = "pathology" | "quality" | "status"

export interface ClinicalBadgeProps {
  /** Badge type determines the visual treatment */
  type: BadgeType
  /** Value to display */
  value: Pathology | QualityLevel | string
  /** Additional CSS classes */
  className?: string
}

const pathologyConfig: Record<
  Pathology,
  { label: string; bgClass: string; textClass: string }
> = {
  DT1: {
    label: "Type 1",
    bgClass: "bg-pathology-dt1-bg",
    textClass: "text-pathology-dt1",
  },
  DT2: {
    label: "Type 2",
    bgClass: "bg-pathology-dt2-bg",
    textClass: "text-pathology-dt2",
  },
  GD: {
    label: "Gestationnel",
    bgClass: "bg-pathology-gd-bg",
    textClass: "text-pathology-gd",
  },
}

const qualityConfig: Record<
  QualityLevel,
  { label: string; bgClass: string; textClass: string; dotClass: string }
> = {
  excellent: {
    label: "Excellent",
    bgClass: "bg-glycemia-normal-bg",
    textClass: "text-glycemia-normal",
    dotClass: "bg-glycemia-normal",
  },
  good: {
    label: "Bon",
    bgClass: "bg-glycemia-normal-bg",
    textClass: "text-glycemia-normal",
    dotClass: "bg-glycemia-normal",
  },
  moderate: {
    label: "Modere",
    bgClass: "bg-glycemia-high-bg",
    textClass: "text-glycemia-high",
    dotClass: "bg-glycemia-high",
  },
  poor: {
    label: "Insuffisant",
    bgClass: "bg-glycemia-low-bg",
    textClass: "text-glycemia-low",
    dotClass: "bg-glycemia-low",
  },
}

/**
 * ClinicalBadge — Badge for clinical status and classifications.
 *
 * Three badge types:
 * - pathology: DT1 (violet), DT2 (blue), GD (pink) — diabetes type
 * - quality: TIR quality level with colored dot indicator
 * - status: Generic text badge with neutral styling
 *
 * Badges are non-interactive and use aria-label for screen readers.
 */
export function ClinicalBadge({
  type,
  value,
  className,
}: ClinicalBadgeProps) {
  if (type === "pathology") {
    const config = pathologyConfig[value as Pathology]
    if (!config) return null

    return (
      <span
        className={cn(
          "inline-flex items-center rounded-full px-2 py-0.5",
          "text-xs font-semibold",
          config.bgClass,
          config.textClass,
          className
        )}
        aria-label={`Diabete ${config.label}`}
      >
        {config.label}
      </span>
    )
  }

  if (type === "quality") {
    const config = qualityConfig[value as QualityLevel]
    if (!config) return null

    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5",
          "text-xs font-medium",
          config.bgClass,
          config.textClass,
          className
        )}
        aria-label={`Qualite du controle: ${config.label}`}
      >
        <span
          className={cn("h-1.5 w-1.5 rounded-full", config.dotClass)}
          aria-hidden="true"
        />
        {config.label}
      </span>
    )
  }

  // type === "status" — generic badge
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5",
        "text-xs font-medium bg-muted text-muted-foreground",
        className
      )}
    >
      {value}
    </span>
  )
}
