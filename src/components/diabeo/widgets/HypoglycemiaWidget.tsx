"use client"

import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"
import { WidgetSkeleton } from "./WidgetSkeleton"
import type { WidgetProps } from "./types"

/**
 * Hypoglycemia Widget
 *
 * Shows the count of detected hypoglycemic episodes and the time elapsed
 * since the most recent event.
 *
 * Color logic:
 *   green (count === 0) : no hypoglycemic events — safe
 *   red   (count > 0)   : at least one event — requires attention
 *
 * Clinical context:
 *   An episode is defined as glucose < 70 mg/dL for >= 15 minutes.
 *   Severe hypoglycemia (< 54 mg/dL) uses the same counter.
 *   Alert threshold: any count > 0 in the selected period is clinically significant.
 */

export interface HypoglycemiaWidgetProps extends WidgetProps {
  /** Number of hypoglycemic events in the selected period */
  count: number
  /** Date of the most recent hypoglycemic event, if available */
  lastEvent?: Date
}

export function HypoglycemiaWidget({
  count,
  lastEvent,
  loading,
  onClick,
  className,
}: HypoglycemiaWidgetProps) {
  const t = useTranslations("metrics")
  const tCommon = useTranslations("common")

  if (loading) {
    return <WidgetSkeleton className={className} />
  }

  /**
   * Returns a human-readable relative time string for the last event.
   * Intentionally kept simple — no external date library required.
   */
  function formatRelativeTime(date: Date): string {
    const diffMs = Date.now() - date.getTime()
    const diffMin = Math.floor(diffMs / 60_000)

    if (diffMin < 1) return tCommon("justNow")
    if (diffMin < 60) return tCommon("ago", { value: tCommon("minuteShort", { count: diffMin }) })

    const diffH = Math.floor(diffMin / 60)
    if (diffH < 24) return tCommon("ago", { value: tCommon("hourShort", { count: diffH }) })

    const diffD = Math.floor(diffH / 24)
    return tCommon("ago", { value: tCommon("dayShort", { count: diffD }) })
  }

  const hasEvents = count > 0
  const valueColorClass = hasEvents ? "text-glycemia-low" : "text-glycemia-normal"
  const label = t("hypoEvents")
  const ariaLabel =
    count === 0
      ? `${label}: ${tCommon("noEvent")}`
      : `${label}: ${tCommon("eventCount", { count })}${lastEvent ? `, dernier ${formatRelativeTime(lastEvent)}` : ""}`

  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                onClick()
              }
            }
          : undefined
      }
      className={cn(
        "rounded-lg bg-white p-4 shadow-sm",
        onClick && "cursor-pointer hover:shadow-md transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600",
        className
      )}
      aria-label={ariaLabel}
    >
      <p className="text-xs text-gray-500 mb-1 font-medium truncate">{label}</p>
      <p className={cn("text-2xl font-bold leading-tight", valueColorClass)}>
        {count}
      </p>
      <p className="text-xs text-gray-400 mt-0.5">
        {hasEvents && lastEvent ? formatRelativeTime(lastEvent) : tCommon("noEvent")}
      </p>
    </div>
  )
}
