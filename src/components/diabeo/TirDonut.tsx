"use client"

import { cn } from "@/lib/utils"

/**
 * Time In Range (TIR) data — 5-zone model per international consensus.
 * All values are percentages and must sum to 100.
 */
export interface TirData {
  /** % time <54 mg/dL — severe hypoglycemia */
  veryLow: number
  /** % time 54-69 mg/dL — hypoglycemia */
  low: number
  /** % time 70-180 mg/dL — in range */
  inRange: number
  /** % time 181-250 mg/dL — hyperglycemia */
  high: number
  /** % time >250 mg/dL — severe hyperglycemia */
  veryHigh: number
}

export interface TirDonutProps {
  /** TIR percentages (must sum to 100) */
  data: TirData
  /** Diameter in pixels. Defaults to 160 */
  size?: number
  /** Stroke width in pixels. Defaults to 20 */
  strokeWidth?: number
  /** Show the in-range percentage as center label */
  showCenterLabel?: boolean
  /** Show the legend below the donut */
  showLegend?: boolean
  /** Additional CSS classes */
  className?: string
}

interface ZoneConfig {
  key: keyof TirData
  label: string
  color: string
  /** tailwind text color class for legend */
  textClass: string
  target: string
}

const ZONES: ZoneConfig[] = [
  {
    key: "veryLow",
    label: "Tres bas (<54)",
    color: "var(--diabeo-tir-very-low)",
    textClass: "text-tir-very-low",
    target: "<1%",
  },
  {
    key: "low",
    label: "Bas (54-69)",
    color: "var(--diabeo-tir-low)",
    textClass: "text-tir-low",
    target: "<4%",
  },
  {
    key: "inRange",
    label: "Cible (70-180)",
    color: "var(--diabeo-tir-in-range)",
    textClass: "text-tir-in-range",
    target: ">70%",
  },
  {
    key: "high",
    label: "Eleve (181-250)",
    color: "var(--diabeo-tir-high)",
    textClass: "text-tir-high",
    target: "<25%",
  },
  {
    key: "veryHigh",
    label: "Tres eleve (>250)",
    color: "var(--diabeo-tir-very-high)",
    textClass: "text-tir-very-high",
    target: "<5%",
  },
]

/**
 * TirDonut — Time In Range donut chart with 5 glycemia zones.
 *
 * Renders an SVG donut chart showing the distribution of glucose readings
 * across the 5 clinical zones. The center displays the in-range percentage.
 *
 * Follows international consensus targets:
 *   Very Low (<54): <1% | Low (54-69): <4% | In Range (70-180): >70%
 *   High (181-250): <25% | Very High (>250): <5%
 *
 * Accessibility: Each segment has a title element for screen readers.
 * The full data breakdown is provided as an accessible description.
 */
export function TirDonut({
  data,
  size = 160,
  strokeWidth = 20,
  showCenterLabel = true,
  showLegend = true,
  className,
}: TirDonutProps) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const center = size / 2

  // Build segments — order: veryHigh, high, inRange, low, veryLow
  // We render from the top (12 o'clock) going clockwise
  const renderOrder: (keyof TirData)[] = [
    "veryHigh",
    "high",
    "inRange",
    "low",
    "veryLow",
  ]

  let cumulativeOffset = 0
  const segments = renderOrder.map((key) => {
    const zone = ZONES.find((z) => z.key === key)!
    const percentage = data[key]
    const dashLength = (percentage / 100) * circumference
    const dashOffset = circumference - cumulativeOffset
    cumulativeOffset += dashLength

    return {
      ...zone,
      percentage,
      dashLength,
      dashOffset,
      gapLength: circumference - dashLength,
    }
  })

  const ariaDescription = ZONES.map(
    (z) => `${z.label}: ${data[z.key].toFixed(1)}%`
  ).join(", ")

  return (
    <div className={cn("flex flex-col items-center gap-3", className)}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`Temps dans la cible: ${data.inRange.toFixed(1)}%. ${ariaDescription}`}
        className="transform -rotate-90"
      >
        {/* Background circle */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="var(--diabeo-neutral-200)"
          strokeWidth={strokeWidth}
        />

        {/* Data segments */}
        {segments.map((segment) =>
          segment.percentage > 0 ? (
            <circle
              key={segment.key}
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={segment.color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${segment.dashLength} ${segment.gapLength}`}
              strokeDashoffset={segment.dashOffset}
              strokeLinecap="butt"
            >
              <title>
                {segment.label}: {segment.percentage.toFixed(1)}%
              </title>
            </circle>
          ) : null
        )}
      </svg>

      {/* Center label overlay */}
      {showCenterLabel && (
        <div
          className="absolute flex flex-col items-center justify-center pointer-events-none"
          style={{ width: size, height: size }}
          aria-hidden="true"
        >
          <span className="text-2xl font-bold text-foreground tabular-nums">
            {Math.round(data.inRange)}%
          </span>
          <span className="text-xs text-muted-foreground">
            dans la cible
          </span>
        </div>
      )}

      {/* Legend */}
      {showLegend && (
        <div
          className="grid grid-cols-1 gap-1 text-xs w-full max-w-[200px]"
          aria-label="Legende des zones de glycemie"
        >
          {ZONES.map((zone) => (
            <div
              key={zone.key}
              className="flex items-center justify-between gap-2"
            >
              <div className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
                  style={{ backgroundColor: zone.color }}
                  aria-hidden="true"
                />
                <span className="text-muted-foreground">{zone.label}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-foreground tabular-nums">
                  {data[zone.key].toFixed(1)}%
                </span>
                <span className="text-muted-foreground/60 tabular-nums">
                  ({zone.target})
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
