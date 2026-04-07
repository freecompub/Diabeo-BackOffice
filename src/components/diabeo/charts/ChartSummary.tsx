"use client"

/**
 * Chart summary — displays readings count, average glucose, and doses count.
 */

import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import type { ChartSummaryData } from "./types"

interface ChartSummaryProps {
  data: ChartSummaryData
  className?: string
}

export function ChartSummary({ data, className }: ChartSummaryProps) {
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
          {Math.round(data.averageGlucose)}
        </span>{" "}
        mg/dL {t("average")}
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
