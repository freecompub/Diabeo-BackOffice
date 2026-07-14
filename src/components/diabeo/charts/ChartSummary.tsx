"use client"

/**
 * Chart summary — displays readings count, average glucose, and doses count.
 */

import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
// Affichage par unité (ADR #32) : moyenne stockée en mg/dL, rendue selon la préférence.
import {
  type GlucoseUnitCode,
  glucoseUnitLabel,
  mgdlToDisplayValue,
} from "@/lib/glucose/units"
import type { ChartSummaryData } from "./types"

interface ChartSummaryProps {
  data: ChartSummaryData
  className?: string
  /** Unité d'affichage (`unitGlycemia` 3/4/5). Défaut mg/dL. `averageGlucose` reste en mg/dL. */
  displayCode?: GlucoseUnitCode
}

export function ChartSummary({ data, className, displayCode = 4 }: ChartSummaryProps) {
  const t = useTranslations("chart")

  return (
    <div
      className={cn(
        "flex items-center gap-6 text-sm text-gray-600",
        className
      )}
    >
      <div>
        <span className="font-medium text-gray-900">{data.readingsCount}</span>{" "}
        {t("readings")}
      </div>
      <div>
        <span className="font-medium text-gray-900">
          {mgdlToDisplayValue(data.averageGlucose, displayCode)}
        </span>{" "}
        {glucoseUnitLabel(displayCode)} {t("average")}
      </div>
      {data.dosesCount > 0 && (
        <div>
          <span className="font-medium text-gray-900">{data.dosesCount}</span>{" "}
          {t("doses")}
        </div>
      )}
    </div>
  )
}
