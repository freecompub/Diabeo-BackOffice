"use client"

/**
 * GlycemiaEvolutionChart — US-WEB-101
 *
 * Full-featured glucose chart with:
 * - Color-coded threshold zones
 * - Insulin dose overlay (bar markers)
 * - Diabetes event markers
 * - Interactive tooltips
 * - Display options menu
 * - Chart summary
 * - Accessible sr-only data table
 * - Keyboard navigable data points
 *
 * Uses Recharts (already installed).
 */

import { useState, useMemo } from "react"
import { useTranslations } from "next-intl"
import { DiabeoEmptyState } from "../DiabeoEmptyState"
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ReferenceArea,
  ReferenceLine,
  Scatter,
} from "recharts"
import { cn } from "@/lib/utils"
import { ChartDisplayOptionsMenu } from "./ChartDisplayOptionsMenu"
import { ChartSummary } from "./ChartSummary"
import type {
  GlucoseDataPoint,
  InsulinDose,
  DiabetesEventMarker,
  GlycemiaThresholds,
  ChartDisplayOptions,
  ChartSummaryData,
} from "./types"
import { getGlucoseZone, ZONE_COLORS, DEFAULT_THRESHOLDS } from "./types"

interface GlycemiaEvolutionChartProps {
  glucoseData: GlucoseDataPoint[]
  insulinDoses?: InsulinDose[]
  events?: DiabetesEventMarker[]
  thresholds?: GlycemiaThresholds
  height?: number
  className?: string
}

interface MergedDataPoint {
  time: string
  glucose?: number
  bolusAmount?: number
  basalAmount?: number
  eventLabel?: string
}

export function GlycemiaEvolutionChart({
  glucoseData,
  insulinDoses = [],
  events = [],
  thresholds = DEFAULT_THRESHOLDS,
  height = 360,
  className,
}: GlycemiaEvolutionChartProps) {
  const t = useTranslations("chart")
  const tGlycemia = useTranslations("glycemia")
  const tInsulin = useTranslations("insulin")

  const [displayOptions, setDisplayOptions] = useState<ChartDisplayOptions>({
    showInsulin: true,
    showEvents: true,
    showThresholds: true,
  })

  // Merge glucose + insulin + events into unified timeline
  const mergedData = useMemo<MergedDataPoint[]>(() => {
    const dataMap = new Map<string, MergedDataPoint>()

    for (const point of glucoseData) {
      dataMap.set(point.time, { time: point.time, glucose: point.glucose })
    }

    if (displayOptions.showInsulin) {
      for (const dose of insulinDoses) {
        const existing = dataMap.get(dose.time) ?? { time: dose.time }
        if (dose.type === "bolus") {
          existing.bolusAmount = (existing.bolusAmount ?? 0) + dose.amount
        } else {
          existing.basalAmount = (existing.basalAmount ?? 0) + dose.amount
        }
        dataMap.set(dose.time, existing)
      }
    }

    if (displayOptions.showEvents) {
      for (const event of events) {
        const existing = dataMap.get(event.time) ?? { time: event.time }
        existing.eventLabel = event.label
        dataMap.set(event.time, existing)
      }
    }

    return Array.from(dataMap.values()).sort((a, b) =>
      a.time.localeCompare(b.time)
    )
  }, [glucoseData, insulinDoses, events, displayOptions])

  // Summary stats
  const summary = useMemo<ChartSummaryData>(() => {
    const glucoseValues = glucoseData.map((d) => d.glucose)
    return {
      readingsCount: glucoseData.length,
      averageGlucose:
        glucoseValues.length > 0
          ? glucoseValues.reduce((a, b) => a + b, 0) / glucoseValues.length
          : 0,
      dosesCount: insulinDoses.length,
    }
  }, [glucoseData, insulinDoses])

  const getZoneLabel = (value: number): string => {
    const zone = getGlucoseZone(value, thresholds)
    return tGlycemia(zone)
  }

  if (glucoseData.length === 0) {
    return (
      <div className={cn("space-y-3", className)}>
        <h3 className="text-sm font-semibold text-gray-900">
          {t("glucoseEvolution")}
        </h3>
        <DiabeoEmptyState variant="noData" />
      </div>
    )
  }

  return (
    <div className={cn("space-y-3", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">
          {t("glucoseEvolution")}
        </h3>
        <ChartDisplayOptionsMenu
          options={displayOptions}
          onChange={setDisplayOptions}
        />
      </div>

      {/* Summary */}
      <ChartSummary data={summary} />

      {/* Chart */}
      <div
        role="img"
        aria-label={`${t("glucoseEvolution")} — ${glucoseData.length} ${t("readings")}`}
        className="h-[240px] sm:h-[300px] md:h-[360px]"
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={mergedData}
            margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--color-border)"
              vertical={false}
            />

            {/* Threshold zones */}
            {displayOptions.showThresholds && (
              <>
                <ReferenceArea
                  y1={thresholds.targetMin}
                  y2={thresholds.targetMax}
                  fill="var(--color-glycemia-normal-bg)"
                  fillOpacity={0.4}
                />
                <ReferenceLine
                  y={thresholds.low}
                  stroke="var(--color-glycemia-low)"
                  strokeDasharray="4 4"
                  strokeWidth={1}
                />
                <ReferenceLine
                  y={thresholds.targetMax}
                  stroke="var(--color-glycemia-high)"
                  strokeDasharray="4 4"
                  strokeWidth={1}
                />
                <ReferenceLine
                  y={thresholds.veryLow}
                  stroke="var(--color-glycemia-very-low)"
                  strokeDasharray="2 2"
                  strokeWidth={1}
                />
                <ReferenceLine
                  y={thresholds.high}
                  stroke="var(--color-glycemia-very-high)"
                  strokeDasharray="2 2"
                  strokeWidth={1}
                />
              </>
            )}

            <XAxis
              dataKey="time"
              tick={{ fontSize: 11, fill: "var(--diabeo-neutral-400)" }}
              tickLine={false}
              axisLine={{ stroke: "var(--color-border)" }}
              interval={Math.max(1, Math.floor(mergedData.length / 8))}
            />

            <YAxis
              yAxisId="glucose"
              domain={[40, Math.min(450, Math.max(300, ...glucoseData.map(d => d.glucose)))]}
              tick={{ fontSize: 11, fill: "var(--diabeo-neutral-400)" }}
              tickLine={false}
              axisLine={{ stroke: "var(--color-border)" }}
              width={40}
            />

            {/* Insulin Y axis (right) */}
            {displayOptions.showInsulin && insulinDoses.length > 0 && (
              <YAxis
                yAxisId="insulin"
                orientation="right"
                domain={[0, "auto"]}
                tick={{ fontSize: 10, fill: "var(--diabeo-neutral-400)" }}
                tickLine={false}
                axisLine={false}
                width={30}
                unit="U"
              />
            )}

            {/* Tooltip */}
            <RechartsTooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const point = payload[0]?.payload as MergedDataPoint
                if (!point) return null

                return (
                  <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-lg text-xs">
                    <p className="font-medium text-gray-900 mb-1">
                      {point.time}
                    </p>
                    {point.glucose != null && (
                      <p
                        className="font-semibold"
                        style={{
                          color:
                            ZONE_COLORS[
                              getGlucoseZone(point.glucose, thresholds)
                            ],
                        }}
                      >
                        {point.glucose} mg/dL — {getZoneLabel(point.glucose)}
                      </p>
                    )}
                    {point.bolusAmount != null && (
                      <p className="text-coral-600">
                        {tInsulin("bolus")}: {point.bolusAmount.toFixed(1)}U
                      </p>
                    )}
                    {point.basalAmount != null && (
                      <p className="text-teal-600">
                        {tInsulin("basal")}: {point.basalAmount.toFixed(2)}U/h
                      </p>
                    )}
                    {point.eventLabel && (
                      <p className="text-gray-600">{point.eventLabel}</p>
                    )}
                  </div>
                )
              }}
            />

            {/* Glucose line */}
            <Line
              yAxisId="glucose"
              type="monotone"
              dataKey="glucose"
              stroke="var(--color-primary)"
              strokeWidth={2}
              dot={false}
              activeDot={{
                r: 5,
                fill: "var(--color-primary)",
                stroke: "white",
                strokeWidth: 2,
              }}
              connectNulls
            />

            {/* Insulin bolus bars */}
            {displayOptions.showInsulin && insulinDoses.length > 0 && (
              <Bar
                yAxisId="insulin"
                dataKey="bolusAmount"
                fill="var(--color-coral-400)"
                opacity={0.7}
                maxBarSize={8}
                radius={[2, 2, 0, 0]}
              />
            )}

            {/* Event markers */}
            {displayOptions.showEvents && events.length > 0 && (
              <Scatter
                yAxisId="glucose"
                dataKey="glucose"
                fill="var(--color-info)"
                shape={(props: { cx?: number; cy?: number; payload?: MergedDataPoint }) => {
                  if (!props.payload?.eventLabel || !props.cx || !props.cy) return null
                  return (
                    <circle
                      cx={props.cx}
                      cy={props.cy}
                      r={4}
                      fill="var(--color-info)"
                      stroke="white"
                      strokeWidth={1.5}
                    />
                  )
                }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-glycemia-normal" />
          {tGlycemia("inRange")} ({thresholds.targetMin}–{thresholds.targetMax})
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-glycemia-high" />
          {tGlycemia("high")} (&gt;{thresholds.targetMax})
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-glycemia-low" />
          {tGlycemia("low")} (&lt;{thresholds.low})
        </span>
        {displayOptions.showInsulin && insulinDoses.length > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-coral-400" />
            {tInsulin("bolus")}
          </span>
        )}
      </div>

      {/* Accessible data table for screen readers */}
      <table className="sr-only" aria-label={t("glucoseEvolution")}>
        <thead>
          <tr>
            <th scope="col">{t("hour")}</th>
            <th scope="col">{t("glucoseMgdl")}</th>
            <th scope="col">{t("zoneLabel")}</th>
          </tr>
        </thead>
        <tbody>
          {glucoseData
            .filter((_, i) => i % 6 === 0)
            .map((point) => (
              <tr key={point.time}>
                <td>{point.time}</td>
                <td>{point.glucose}</td>
                <td>{getZoneLabel(point.glucose)}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  )
}
