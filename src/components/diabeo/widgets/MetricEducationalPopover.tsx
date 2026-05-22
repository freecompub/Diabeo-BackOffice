"use client"

import type { ReactNode } from "react"
import { useTranslations } from "next-intl"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { WidgetType } from "./types"

/**
 * MetricEducationalPopover
 *
 * Wraps a widget with a tooltip that explains the clinical meaning of the metric.
 * Triggered on hover/focus. Uses the "education" i18n namespace.
 *
 * Accessibility:
 *   - The tooltip content is announced by screen readers via the Tooltip primitive.
 *   - The trigger wrapper is transparent to the DOM structure of the child.
 *
 * The component requires a TooltipProvider ancestor — DataSummaryGrid provides one.
 * When used standalone, wrap in <TooltipProvider>.
 *
 * @param metricType  - One of the six widget types; maps to education.{metricType}
 * @param children    - The widget element that acts as the tooltip trigger
 */

/** Maps WidgetType to the education namespace translation key */
const EDUCATION_KEY_MAP: Record<WidgetType, string> = {
  averageGlucose: "averageGlucose",
  hba1c: "hba1c",
  hypoglycemia: "hypoEvents",
  timeInRange: "timeInRange",
  glycemicVariability: "cv",
  standardDeviation: "standardDeviation",
}

/**
 * Fix #5 (session 2026-05-22) — defaults ADA pour les variables ICU des
 * messages éducatifs `hypoEvents` (`{threshold}`) et `timeInRange`
 * (`{targetMin}`, `{targetMax}`). Sans 2e arg à `t()`, next-intl throw
 * `FORMATTING_ERROR: variable "threshold" was not provided`.
 *
 * Valeurs ADA Standards of Medical Care in Diabetes (référence clinique
 * cohérente avec `CLAUDE.md`) :
 *   - Hypoglycémie niveau 1 : < 70 mg/dL
 *   - Target range glycémie : 70–180 mg/dL
 *
 * Suivi V1.5 : si la vue devient patient-aware, lire ces seuils depuis
 * `GlycemiaObjective` / `CgmObjective` du patient courant (hors scope #5).
 */
const ADA_HYPO_THRESHOLD = 70
const ADA_TARGET_MIN = 70
const ADA_TARGET_MAX = 180

const EDUCATION_VARS: Partial<Record<WidgetType, Record<string, number>>> = {
  hypoglycemia: { threshold: ADA_HYPO_THRESHOLD },
  timeInRange: { targetMin: ADA_TARGET_MIN, targetMax: ADA_TARGET_MAX },
}

export interface MetricEducationalPopoverProps {
  /** The metric type — determines which education text is shown */
  metricType: WidgetType
  /** The widget element that triggers the tooltip */
  children: ReactNode
}

export function MetricEducationalPopover({
  metricType,
  children,
}: MetricEducationalPopoverProps) {
  const t = useTranslations("education")
  const key = EDUCATION_KEY_MAP[metricType]
  const vars = EDUCATION_VARS[metricType]

  return (
    <Tooltip>
      <TooltipTrigger className="w-full text-start">
        {children}
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        align="start"
        className="max-w-xs text-xs leading-relaxed"
      >
        {t(key as Parameters<typeof t>[0], vars)}
      </TooltipContent>
    </Tooltip>
  )
}
