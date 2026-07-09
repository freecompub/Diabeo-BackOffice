"use client"

/**
 * Insulin summary — pie chart (basal vs bolus) + total units card.
 */

import { useTranslations } from "next-intl"
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip as RechartsTooltip,
} from "recharts"
import { cn } from "@/lib/utils"
import { tokens } from "@/design-system/tokens"
import type { InsulinSummaryData } from "./types"

interface InsulinSummaryProps {
  data: InsulinSummaryData
  className?: string
}

// Couleurs Recharts : issues du module de tokens (design-system) — jamais de `var(--color-*)` en dur (CLAUDE.md).
const COLORS = {
  basal: tokens.brand.primary[500], // teal
  bolus: tokens.brand.secondary[500], // coral
}

export function InsulinSummary({ data, className }: InsulinSummaryProps) {
  const t = useTranslations("insulin")

  const pieData = [
    { name: t("basal"), value: data.basalUnits, color: COLORS.basal },
    { name: t("bolus"), value: data.bolusUnits, color: COLORS.bolus },
  ]

  return (
    <div className={cn("space-y-3", className)}>
      <h4 className="text-sm font-medium text-foreground">{t("total")}</h4>

      <div className="flex items-center gap-4">
        {/* Pie chart */}
        <div className="h-20 w-20 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={pieData}
                dataKey="value"
                cx="50%"
                cy="50%"
                innerRadius={22}
                outerRadius={36}
                paddingAngle={2}
                strokeWidth={0}
              >
                {pieData.map((entry, index) => (
                  <Cell key={index} fill={entry.color} />
                ))}
              </Pie>
              <RechartsTooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.[0]) return null
                  const item = payload[0].payload as {
                    name: string
                    value: number
                  }
                  return (
                    <div className="rounded bg-foreground px-2 py-1 text-xs text-background">
                      {item.name}: {item.value.toFixed(1)}U
                    </div>
                  )
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Totals */}
        <div className="flex-1 space-y-1">
          <p className="text-2xl font-bold text-foreground">
            {data.totalUnits.toFixed(1)}
            <span className="text-sm font-normal text-muted-foreground ms-1">U</span>
          </p>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-teal-500" />
              {t("basal")} {data.basalPercent}%
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-coral-500" />
              {t("bolus")} {data.bolusPercent}%
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
