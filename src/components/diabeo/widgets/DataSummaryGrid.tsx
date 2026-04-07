"use client"

import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import { TooltipProvider } from "@/components/ui/tooltip"

import { AverageGlucoseWidget } from "./AverageGlucoseWidget"
import { HbA1cWidget } from "./HbA1cWidget"
import { HypoglycemiaWidget } from "./HypoglycemiaWidget"
import { TimeInRangeWidget } from "./TimeInRangeWidget"
import { GlycemicVariabilityWidget } from "./GlycemicVariabilityWidget"
import { StandardDeviationWidget } from "./StandardDeviationWidget"
import { MetricEducationalPopover } from "./MetricEducationalPopover"
import type { WidgetData, WidgetType } from "./types"

/**
 * DataSummaryGrid
 *
 * Read-only summary grid displaying 6 clinical metrics in a 3-column layout.
 * Each widget is wrapped in a MetricEducationalPopover that explains the metric
 * on hover/focus.
 *
 * Layout:
 *   Desktop (md+) : 3 columns
 *   Tablet (sm)   : 2 columns
 *   Mobile        : 1 column
 *
 * Row 1: Average Glucose | Estimated HbA1c | Hypoglycemic Events
 * Row 2: Time In Range   | Glycemic Variability (CV) | Standard Deviation
 *
 * Accessibility:
 *   - Section has role="region" with a descriptive aria-label.
 *   - Each widget carries its own aria-label with the metric name + value.
 *   - Tooltip content is announced by screen readers.
 *   - Interactive widgets (when onMetricTapped is provided) are keyboard accessible.
 *
 * @param data           - Widget data payload; missing keys render a skeleton
 * @param loading        - When true, all widgets show loading skeletons
 * @param onMetricTapped - Optional callback when a widget is clicked
 * @param showTitle      - Whether to render the "Résumé" section heading
 * @param className      - Additional CSS classes for the root element
 */

export interface DataSummaryGridProps {
  data: WidgetData
  loading?: boolean
  onMetricTapped?: (metric: WidgetType) => void
  showTitle?: boolean
  className?: string
}

export function DataSummaryGrid({
  data,
  loading = false,
  onMetricTapped,
  showTitle = false,
  className,
}: DataSummaryGridProps) {
  const t = useTranslations("metrics")

  const isLoading = (key: keyof WidgetData) =>
    loading || data[key] === undefined

  const handleClick = (metric: WidgetType) =>
    onMetricTapped ? () => onMetricTapped(metric) : undefined

  return (
    <TooltipProvider>
      <section
        role="region"
        aria-label={t("resumeMetrics")}
        className={cn("w-full", className)}
      >
        {showTitle && (
          <h2 className="text-sm font-semibold text-gray-700 mb-3">
            {t("dataCapture")}
          </h2>
        )}

        <div
          className={cn(
            "grid gap-2",
            "grid-cols-1",
            "sm:grid-cols-2",
            "md:grid-cols-3"
          )}
        >
          {/* Row 1 — col 1: Average Glucose */}
          <MetricEducationalPopover metricType="averageGlucose">
            <AverageGlucoseWidget
              value={data.averageGlucose?.value ?? 0}
              unit={data.averageGlucose?.unit ?? "mg/dL"}
              loading={isLoading("averageGlucose")}
              onClick={handleClick("averageGlucose")}
              aria-label={
                data.averageGlucose
                  ? `${t("averageGlucose")}: ${data.averageGlucose.value} ${data.averageGlucose.unit}`
                  : t("averageGlucose")
              }
            />
          </MetricEducationalPopover>

          {/* Row 1 — col 2: HbA1c */}
          <MetricEducationalPopover metricType="hba1c">
            <HbA1cWidget
              value={data.hba1c?.value ?? 0}
              loading={isLoading("hba1c")}
              onClick={handleClick("hba1c")}
            />
          </MetricEducationalPopover>

          {/* Row 1 — col 3: Hypoglycemia */}
          <MetricEducationalPopover metricType="hypoglycemia">
            <HypoglycemiaWidget
              count={data.hypoglycemia?.count ?? 0}
              lastEvent={data.hypoglycemia?.lastEvent}
              loading={isLoading("hypoglycemia")}
              onClick={handleClick("hypoglycemia")}
            />
          </MetricEducationalPopover>

          {/* Row 2 — col 1: Time In Range */}
          <MetricEducationalPopover metricType="timeInRange">
            <TimeInRangeWidget
              inRange={data.timeInRange?.inRange ?? 0}
              low={data.timeInRange?.low ?? 0}
              veryLow={data.timeInRange?.veryLow ?? 0}
              high={data.timeInRange?.high ?? 0}
              veryHigh={data.timeInRange?.veryHigh ?? 0}
              readingCount={data.timeInRange?.readingCount}
              loading={isLoading("timeInRange")}
              onClick={handleClick("timeInRange")}
            />
          </MetricEducationalPopover>

          {/* Row 2 — col 2: Glycemic Variability (CV) */}
          <MetricEducationalPopover metricType="glycemicVariability">
            <GlycemicVariabilityWidget
              value={data.cv?.value ?? 0}
              loading={isLoading("cv")}
              onClick={handleClick("glycemicVariability")}
            />
          </MetricEducationalPopover>

          {/* Row 2 — col 3: Standard Deviation */}
          <MetricEducationalPopover metricType="standardDeviation">
            <StandardDeviationWidget
              value={data.standardDeviation?.value ?? 0}
              unit={data.standardDeviation?.unit ?? "mg/dL"}
              loading={isLoading("standardDeviation")}
              onClick={handleClick("standardDeviation")}
            />
          </MetricEducationalPopover>
        </div>
      </section>
    </TooltipProvider>
  )
}
