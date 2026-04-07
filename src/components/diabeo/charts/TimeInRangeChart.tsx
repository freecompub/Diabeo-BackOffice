"use client"

/**
 * Time in Range — combined pie chart + horizontal stacked bar.
 * 5-zone model per international consensus.
 */

import { useTranslations } from "next-intl"
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts"
import { cn } from "@/lib/utils"
import type { TimeInRangeData } from "./types"

interface TimeInRangeChartProps {
  data: TimeInRangeData
  className?: string
}

const ZONE_COLORS = [
  { key: "veryLow", color: "var(--color-tir-very-low)", twBg: "bg-tir-very-low" },
  { key: "low", color: "var(--color-tir-low)", twBg: "bg-tir-low" },
  { key: "inRange", color: "var(--color-tir-in-range)", twBg: "bg-tir-in-range" },
  { key: "high", color: "var(--color-tir-high)", twBg: "bg-tir-high" },
  { key: "veryHigh", color: "var(--color-tir-very-high)", twBg: "bg-tir-very-high" },
] as const

export function TimeInRangeChart({ data, className }: TimeInRangeChartProps) {
  const t = useTranslations("tir")

  const pieData = ZONE_COLORS.map((zone) => ({
    name: t(zone.key),
    value: data[zone.key as keyof TimeInRangeData],
    color: zone.color,
  })).filter((d) => d.value > 0)

  return (
    <div className={cn("space-y-4", className)}>
      <h4 className="text-sm font-medium text-gray-900">{t("title")}</h4>

      <div className="flex items-center gap-6">
        {/* Donut */}
        <div className="relative h-28 w-28 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={pieData}
                dataKey="value"
                cx="50%"
                cy="50%"
                innerRadius={32}
                outerRadius={48}
                paddingAngle={1}
                strokeWidth={0}
              >
                {pieData.map((entry, index) => (
                  <Cell key={index} fill={entry.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          {/* Center label */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <p className="text-lg font-bold text-gray-900">
                {Math.round(data.inRange)}%
              </p>
              <p className="text-[10px] text-gray-500">{t("inRange")}</p>
            </div>
          </div>
        </div>

        {/* Stacked bar + legend */}
        <div className="flex-1 space-y-2">
          {/* Horizontal stacked bar */}
          <div
            className="flex h-4 w-full overflow-hidden rounded-full"
            role="img"
            aria-label={`${t("title")}: ${Math.round(data.inRange)}% ${t("inRange")}`}
          >
            {ZONE_COLORS.map((zone) => {
              const value = data[zone.key as keyof TimeInRangeData]
              if (value <= 0) return null
              return (
                <div
                  key={zone.key}
                  className={cn(zone.twBg)}
                  style={{ width: `${value}%` }}
                  title={`${t(zone.key)}: ${Math.round(value)}%`}
                />
              )
            })}
          </div>

          {/* Legend */}
          <div className="space-y-0.5">
            {ZONE_COLORS.map((zone) => {
              const value = data[zone.key as keyof TimeInRangeData]
              return (
                <div
                  key={zone.key}
                  className="flex items-center justify-between text-xs"
                >
                  <span className="flex items-center gap-1.5 text-gray-600">
                    <span
                      className={cn("inline-block h-2 w-2 rounded-full", zone.twBg)}
                    />
                    {t(zone.key)}
                  </span>
                  <span className="font-medium text-gray-900">
                    {Math.round(value)}%
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
