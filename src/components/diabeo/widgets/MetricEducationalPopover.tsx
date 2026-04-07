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
        {t(key as Parameters<typeof t>[0])}
      </TooltipContent>
    </Tooltip>
  )
}
