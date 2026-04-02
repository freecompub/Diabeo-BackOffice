"use client"

import { cn } from "@/lib/utils"

export type AlertSeverity = "info" | "warning" | "critical" | "hypo" | "hyper"

export interface AlertBannerProps {
  /** Severity level determines color and behavior */
  severity: AlertSeverity
  /** Main alert title */
  title: string
  /** Optional description text */
  description?: string
  /** Optional glucose value to display */
  glucoseValue?: number
  /** Unit for glucose display */
  glucoseUnit?: string
  /** Whether the alert can be dismissed */
  dismissible?: boolean
  /** Called when the dismiss button is clicked */
  onDismiss?: () => void
  /** Additional CSS classes */
  className?: string
  /** Child elements (e.g., action buttons) */
  children?: React.ReactNode
}

const severityConfig: Record<
  AlertSeverity,
  {
    bgClass: string
    borderClass: string
    textClass: string
    iconPath: string
    ariaRole: "alert" | "status"
    ariaLive: "assertive" | "polite"
  }
> = {
  info: {
    bgClass: "bg-feedback-info-bg",
    borderClass: "border-l-4 border-l-feedback-info",
    textClass: "text-feedback-info",
    iconPath:
      "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    ariaRole: "status",
    ariaLive: "polite",
  },
  warning: {
    bgClass: "bg-feedback-warning-bg",
    borderClass: "border-l-4 border-l-feedback-warning",
    textClass: "text-feedback-warning",
    iconPath:
      "M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z",
    ariaRole: "alert",
    ariaLive: "assertive",
  },
  critical: {
    bgClass: "bg-glycemia-critical-bg",
    borderClass: "border-l-4 border-l-glycemia-critical",
    textClass: "text-glycemia-critical",
    iconPath:
      "M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z",
    ariaRole: "alert",
    ariaLive: "assertive",
  },
  hypo: {
    bgClass: "bg-glycemia-low-bg",
    borderClass: "border-l-4 border-l-glycemia-low",
    textClass: "text-glycemia-low",
    iconPath:
      "M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z",
    ariaRole: "alert",
    ariaLive: "assertive",
  },
  hyper: {
    bgClass: "bg-glycemia-high-bg",
    borderClass: "border-l-4 border-l-glycemia-high",
    textClass: "text-glycemia-high",
    iconPath:
      "M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z",
    ariaRole: "alert",
    ariaLive: "assertive",
  },
}

/**
 * AlertBanner — Medical alert banner for clinical notifications.
 *
 * Designed to be impossible to miss for critical medical alerts.
 * Uses role="alert" and aria-live="assertive" for critical/hypo/hyper
 * severity levels, ensuring screen readers announce immediately.
 *
 * Severity levels:
 * - info: General information (blue, polite announcement)
 * - warning: Attention needed (amber, assertive)
 * - critical: Immediate action required (red, assertive, pulsing)
 * - hypo: Hypoglycemia detected (red, assertive)
 * - hyper: Hyperglycemia detected (amber, assertive)
 */
export function AlertBanner({
  severity,
  title,
  description,
  glucoseValue,
  glucoseUnit = "mg/dL",
  dismissible = false,
  onDismiss,
  className,
  children,
}: AlertBannerProps) {
  const config = severityConfig[severity]
  const isCritical = severity === "critical" || severity === "hypo"

  return (
    <div
      role={config.ariaRole}
      aria-live={config.ariaLive}
      className={cn(
        "rounded-lg p-4",
        config.bgClass,
        config.borderClass,
        isCritical && "animate-clinical-pulse shadow-diabeo-critical",
        className
      )}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <svg
          className={cn("h-5 w-5 shrink-0 mt-0.5", config.textClass)}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d={config.iconPath}
          />
        </svg>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className={cn("text-sm font-semibold", config.textClass)}>
              {title}
            </h3>
            {glucoseValue !== undefined && (
              <span
                className={cn(
                  "text-sm font-bold tabular-nums",
                  config.textClass
                )}
                aria-label={`Glycemie: ${glucoseValue} ${glucoseUnit}`}
              >
                {glucoseValue} {glucoseUnit}
              </span>
            )}
          </div>
          {description && (
            <p className="mt-1 text-sm text-foreground/80">{description}</p>
          )}
          {children && <div className="mt-2">{children}</div>}
        </div>

        {/* Dismiss button */}
        {dismissible && onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className={cn(
              "shrink-0 rounded-md p-1 transition-colors",
              "hover:bg-foreground/10 focus-visible:outline-2",
              "focus-visible:outline-offset-2 focus-visible:outline-current"
            )}
            aria-label="Fermer l'alerte"
          >
            <svg
              className="h-4 w-4 text-foreground/60"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}
