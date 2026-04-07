"use client"

/**
 * Hypoglycemia counter — shows total events, last event, and daily histogram.
 */

import { useTranslations } from "next-intl"
import { AlertTriangle } from "lucide-react"
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
} from "recharts"
import { cn } from "@/lib/utils"
import type { HypoglycemiaData } from "./types"

interface HypoglycemiaCounterProps {
  data: HypoglycemiaData
  className?: string
}

export function HypoglycemiaCounter({
  data,
  className,
}: HypoglycemiaCounterProps) {
  const t = useTranslations("chart")

  return (
    <div className={cn("space-y-3", className)}>
      {/* Summary */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle
            className="h-4 w-4 text-glycemia-low"
            aria-hidden="true"
          />
          <span className="text-sm font-medium text-gray-900">
            {t("hypoCount")}
          </span>
        </div>
        <span
          className={cn(
            "text-lg font-bold",
            data.totalCount > 0 ? "text-glycemia-low" : "text-glycemia-normal"
          )}
        >
          {data.totalCount}
        </span>
      </div>

      {/* Last event */}
      <p className="text-xs text-gray-500">
        {data.lastEventTime
          ? `${t("lastHypo")}: ${formatRelativeTime(data.lastEventTime)}`
          : t("noHypo")}
      </p>

      {/* Histogram */}
      {data.dailyCounts.length > 0 && (
        <div className="h-24">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.dailyCounts}>
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "#9CA3AF" }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis hide allowDecimals={false} />
              <RechartsTooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.[0]) return null
                  const item = payload[0].payload as {
                    date: string
                    count: number
                  }
                  return (
                    <div className="rounded bg-gray-900 px-2 py-1 text-xs text-white">
                      {item.date}: {item.count}
                    </div>
                  )
                }}
              />
              <Bar
                dataKey="count"
                fill="var(--color-glycemia-low)"
                radius={[2, 2, 0, 0]}
                maxBarSize={16}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

function formatRelativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMin / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMin < 60) return `${diffMin}min`
  if (diffHours < 24) return `${diffHours}h`
  return `${diffDays}j`
}
