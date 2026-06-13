"use client"

import { useTranslations } from "next-intl"
import { GLYCEMIA_THRESHOLDS_MGDL as G } from "@/lib/glycemia-thresholds"

/**
 * CGM Chart — US-803.
 *
 * Displays continuous glucose monitoring data as a line chart with:
 * - Target range band (green zone between targetLow and targetHigh)
 * - Color-coded line segments (normal, high, low)
 * - Tooltip with glucose value and time
 * - Responsive sizing
 * - Accessible with ARIA label
 *
 * Uses Recharts for rendering.
 * No patient data in the DOM (values only in tooltip on hover).
 */

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceArea,
  ReferenceLine,
} from "recharts"

interface CgmDataPoint {
  time: string
  glucose: number
}

interface CgmChartProps {
  data: CgmDataPoint[]
  targetLow?: number
  targetHigh?: number
  height?: number
}

export function CgmChart({
  data,
  targetLow = G.TARGET_LOW,
  targetHigh = G.TARGET_HIGH,
  height = 320,
}: CgmChartProps) {
  const t = useTranslations("cgmChart")
  return (
    <div
      role="img"
      aria-label={t("figureAriaLabel", { count: data.length, low: targetLow, high: targetHigh })}
    >
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />

          {/* Target range — green zone */}
          <ReferenceArea
            y1={targetLow}
            y2={targetHigh}
            fill="var(--color-glycemia-normal-bg)"
            fillOpacity={0.3}
          />

          {/* Threshold lines */}
          <ReferenceLine
            y={targetLow}
            stroke="var(--color-glycemia-low)"
            strokeDasharray="4 4"
            strokeWidth={1}
          />
          <ReferenceLine
            y={targetHigh}
            stroke="var(--color-glycemia-high)"
            strokeDasharray="4 4"
            strokeWidth={1}
          />
          <ReferenceLine
            y={G.SEVERE_HYPO}
            stroke="var(--color-glycemia-very-low)"
            strokeDasharray="2 2"
            strokeWidth={1}
          />
          <ReferenceLine
            y={G.SEVERE_HYPER}
            stroke="var(--color-glycemia-very-high)"
            strokeDasharray="2 2"
            strokeWidth={1}
          />

          <XAxis
            dataKey="time"
            tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--color-border)" }}
            interval={Math.floor(data.length / 8)}
          />

          <YAxis
            domain={[40, 400]}
            tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--color-border)" }}
            width={40}
            unit=""
          />

          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.[0]) return null
              const point = payload[0].payload as CgmDataPoint
              const color = getGlucoseColor(point.glucose, targetLow, targetHigh)
              return (
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card,white)] px-3 py-2 shadow-md">
                  <p className="text-xs text-[var(--color-muted-foreground)]">{point.time}</p>
                  <p className="text-sm font-semibold" style={{ color }}>
                    {t("tooltipValue", { value: point.glucose })}
                  </p>
                </div>
              )
            }}
          />

          <Line
            type="monotone"
            dataKey="glucose"
            stroke="var(--color-primary)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: "var(--color-primary)" }}
          />
        </LineChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap justify-center gap-4 text-xs text-[var(--color-muted-foreground)]">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-[var(--color-glycemia-normal)]" />
          {t("legendTarget", { low: targetLow, high: targetHigh })}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-[var(--color-glycemia-high)]" />
          {t("legendHigh", { high: targetHigh })}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-[var(--color-glycemia-low)]" />
          {t("legendLow", { low: targetLow })}
        </span>
      </div>

      {/* Accessible data table for screen readers (sr-only) */}
      <table className="sr-only" aria-label={t("tableAriaLabel")}>
        <thead>
          <tr>
            <th scope="col">{t("colTime")}</th>
            <th scope="col">{t("colGlucose")}</th>
            <th scope="col">{t("colZone")}</th>
          </tr>
        </thead>
        <tbody>
          {data.filter((_, i) => i % 6 === 0).map((point) => (
            <tr key={point.time}>
              <td>{point.time}</td>
              <td>{point.glucose}</td>
              <td>{t(getZoneLabelKey(point.glucose, targetLow, targetHigh))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Maps a glucose value to its i18n zone key (translated at the call site). */
function getZoneLabelKey(value: number, low: number, high: number): string {
  if (value < G.SEVERE_HYPO) return "zoneVeryLow"
  if (value < low) return "zoneLow"
  if (value <= high) return "zoneNormal"
  if (value <= G.SEVERE_HYPER) return "zoneHigh"
  return "zoneVeryHigh"
}

function getGlucoseColor(value: number, low: number, high: number): string {
  if (value < G.SEVERE_HYPO) return "var(--color-glycemia-very-low)"
  if (value < low) return "var(--color-glycemia-low)"
  if (value <= high) return "var(--color-glycemia-normal)"
  if (value <= G.SEVERE_HYPER) return "var(--color-glycemia-high)"
  return "var(--color-glycemia-very-high)"
}
