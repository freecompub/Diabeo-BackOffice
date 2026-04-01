"use client"

import { cn } from "@/lib/utils"
import { GlycemiaValue, type GlycemiaThresholds } from "./GlycemiaValue"
import { ClinicalBadge, type Pathology } from "./ClinicalBadge"

export interface PatientCardProps {
  /** Patient display name (already decrypted) */
  name: string
  /** Patient pathology type */
  pathology: Pathology
  /** Patient age */
  age?: number
  /** Latest glucose reading in mg/dL */
  latestGlucose?: number
  /** Unit for glucose display */
  glucoseUnit?: "mg/dL" | "g/L" | "mmol/L"
  /** Custom glucose thresholds */
  glucoseThresholds?: GlycemiaThresholds
  /** Time In Range percentage (0-100) */
  tirPercentage?: number
  /** Last sync date from CGM/device */
  lastSync?: Date
  /** Whether the patient is currently active */
  isActive?: boolean
  /** Click handler for navigation */
  onClick?: () => void
  /** Additional CSS classes */
  className?: string
}

/**
 * Returns a human-readable relative time string.
 * Avoids exposing exact timestamps in the UI for privacy.
 */
function formatRelativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)

  if (diffMins < 1) return "A l'instant"
  if (diffMins < 60) return `Il y a ${diffMins} min`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `Il y a ${diffHours}h`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays === 1) return "Hier"
  if (diffDays < 7) return `Il y a ${diffDays}j`
  return `Il y a ${Math.floor(diffDays / 7)} sem.`
}

/**
 * Returns a color class for the TIR percentage.
 * >70% = good (green), 50-70% = moderate (amber), <50% = poor (red)
 */
function getTirColorClass(percentage: number): string {
  if (percentage >= 70) return "text-glycemia-normal"
  if (percentage >= 50) return "text-glycemia-high"
  return "text-glycemia-low"
}

/**
 * PatientCard — Summary card for a patient in the dashboard.
 *
 * Displays key patient information at a glance:
 * - Name, pathology badge, active status
 * - Latest glucose reading with color coding
 * - TIR percentage with quality indicator
 * - Last device sync time
 *
 * IMPORTANT: This component receives already-decrypted data.
 * Never store patient data in component state beyond render.
 * The parent is responsible for decryption and cleanup.
 */
export function PatientCard({
  name,
  pathology,
  age,
  latestGlucose,
  glucoseUnit = "mg/dL",
  glucoseThresholds,
  tirPercentage,
  lastSync,
  isActive = true,
  onClick,
  className,
}: PatientCardProps) {
  const isInteractive = !!onClick
  const Component = isInteractive ? "button" : "div"

  return (
    <Component
      type={isInteractive ? "button" : undefined}
      onClick={onClick}
      aria-label={`Patient ${name}, ${pathology}${latestGlucose ? `, glycemie ${latestGlucose} ${glucoseUnit}` : ""}`}
      className={cn(
        "group relative w-full rounded-xl border border-border bg-card p-4",
        "text-left shadow-diabeo-xs transition-all",
        "duration-200 ease-out",
        isInteractive && [
          "cursor-pointer",
          "hover:shadow-diabeo-md hover:border-teal-300",
          "focus-visible:outline-2 focus-visible:outline-offset-2",
          "focus-visible:outline-teal-600",
          "active:translate-y-px",
        ],
        !isActive && "opacity-60",
        className
      )}
    >
      {/* Header row: name + badge */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          {/* Avatar placeholder */}
          <div
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center",
              "rounded-full bg-teal-100 text-teal-700",
              "text-sm font-semibold"
            )}
            aria-hidden="true"
          >
            {name
              .split(" ")
              .map((n) => n[0])
              .join("")
              .slice(0, 2)
              .toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">
              {name}
            </p>
            {age !== undefined && (
              <p className="text-xs text-muted-foreground">{age} ans</p>
            )}
          </div>
        </div>
        <ClinicalBadge type="pathology" value={pathology} />
      </div>

      {/* Metrics row */}
      <div className="flex items-end justify-between gap-4">
        {/* Latest glucose */}
        <div>
          <p className="text-xs text-muted-foreground mb-0.5">
            Derniere glycemie
          </p>
          {latestGlucose !== undefined ? (
            <GlycemiaValue
              value={latestGlucose}
              unit={glucoseUnit}
              thresholds={glucoseThresholds}
              size="lg"
              showUnit
            />
          ) : (
            <span className="text-sm text-muted-foreground">--</span>
          )}
        </div>

        {/* TIR + Sync */}
        <div className="text-right">
          {tirPercentage !== undefined && (
            <div className="mb-1">
              <p className="text-xs text-muted-foreground">TIR</p>
              <p
                className={cn(
                  "text-lg font-bold tabular-nums",
                  getTirColorClass(tirPercentage)
                )}
              >
                {Math.round(tirPercentage)}%
              </p>
            </div>
          )}
          {lastSync && (
            <p className="text-xs text-muted-foreground">
              {formatRelativeTime(lastSync)}
            </p>
          )}
        </div>
      </div>

      {/* Active status indicator */}
      {!isActive && (
        <div className="absolute top-2 right-2">
          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            Inactif
          </span>
        </div>
      )}
    </Component>
  )
}
