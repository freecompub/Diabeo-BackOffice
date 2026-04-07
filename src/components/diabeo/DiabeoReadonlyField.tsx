"use client"

/**
 * DiabeoReadonlyField — Read-only display field for clinical data.
 *
 * Renders a labeled value in a non-interactive, card-like container.
 * Used throughout the Diabeo BackOffice to show patient data that cannot
 * be edited in the current context (view-only role, locked record, etc.).
 *
 * When `copyable` is true, clicking the value copies it to the clipboard
 * and briefly shows a "Copié !" tooltip confirmation.
 *
 * Layout:
 *   ┌────────────────────────────┐
 *   │  [icon]  Label             │
 *   │          Value text        │
 *   └────────────────────────────┘
 *
 * @example
 * // Patient INS number (copyable for medical staff workflow)
 * <DiabeoReadonlyField
 *   label="Numéro INS"
 *   value="1 85 07 75 056 789 12"
 *   copyable
 * />
 *
 * @example
 * // Last CGM sync time with icon
 * <DiabeoReadonlyField
 *   label="Dernière synchronisation CGM"
 *   value="il y a 12 minutes"
 *   icon={<Wifi />}
 * />
 *
 * @example
 * // ReactNode value — clinical badge
 * <DiabeoReadonlyField
 *   label="Pathologie"
 *   value={<ClinicalBadge type="pathology" value="DT1" />}
 * />
 *
 * Accessibility:
 * - Label rendered as a <dt> analog via aria-label on the container
 * - Copy button: aria-label "Copier [label]" + aria-live region for feedback
 * - Focus ring on copyable container: teal-600
 *
 * Security note:
 * - NEVER pass decrypted health data as `value` in server-rendered HTML —
 *   this component must receive already-decrypted values from the server layer.
 *   The display itself does not perform any decryption.
 */

import * as React from "react"
import { Copy, Check } from "lucide-react"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DiabeoReadonlyFieldProps {
  /**
   * Small muted label displayed above the value.
   */
  label: string

  /**
   * The value to display. Accepts a string, number, or a ReactNode
   * (e.g., a ClinicalBadge or a formatted date).
   */
  value: string | number | React.ReactNode

  /**
   * Optional icon rendered to the left of the label+value block.
   * Use a 16px lucide icon for visual consistency.
   */
  icon?: React.ReactNode

  /**
   * Additional CSS classes for the outer container.
   */
  className?: string

  /**
   * When true, clicking the field copies the value to the clipboard.
   * Only works when `value` is a string or number.
   * Shows a brief "Copié !" feedback after copying.
   */
  copyable?: boolean
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * DiabeoReadonlyField
 *
 * "use client" is required for clipboard API and copy feedback state.
 * The component does NOT mutate any data — it is purely display logic.
 */
function DiabeoReadonlyField({
  label,
  value,
  icon,
  className,
  copyable = false,
}: DiabeoReadonlyFieldProps) {
  const [copied, setCopied] = React.useState(false)
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  // -------------------------------------------------------------------------
  // Clipboard handler
  // -------------------------------------------------------------------------

  const handleCopy = React.useCallback(async () => {
    if (!copyable) return
    const textValue =
      typeof value === "string" || typeof value === "number"
        ? String(value)
        : null

    if (!textValue) return

    try {
      await navigator.clipboard.writeText(textValue)
      setCopied(true)

      // Clear any pending reset
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API unavailable (e.g., non-secure context) — silently ignore
    }
  }, [copyable, value])

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  // -------------------------------------------------------------------------
  // Determine if value is copyable (only strings and numbers)
  // -------------------------------------------------------------------------
  const isCopyable =
    copyable &&
    (typeof value === "string" || typeof value === "number")

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const content = (
    <div className="flex min-w-0 items-start gap-2.5">
      {/* Leading icon */}
      {icon && (
        <span
          className={cn(
            "mt-0.5 shrink-0 text-muted-foreground",
            "[&_svg]:size-4"
          )}
          aria-hidden="true"
        >
          {icon}
        </span>
      )}

      {/* Label + value block */}
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-xs font-medium text-muted-foreground leading-none">
          {label}
        </span>
        <span className="text-sm font-medium text-foreground leading-snug break-words">
          {value}
        </span>
      </div>

      {/* Copy feedback icon — only shown for copyable fields */}
      {isCopyable && (
        <span
          className={cn(
            "ml-auto shrink-0 mt-0.5 text-muted-foreground transition-colors",
            copied && "text-feedback-success",
            "[&_svg]:size-3.5"
          )}
          aria-hidden="true"
        >
          {copied ? <Check /> : <Copy />}
        </span>
      )}
    </div>
  )

  // Copyable: wrap in a button for keyboard + pointer interaction
  if (isCopyable) {
    return (
      <div className={cn("relative", className)}>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={`Copier ${label}`}
          className={cn(
            "w-full rounded-lg bg-gray-50 px-3 py-2.5 text-left",
            "border border-transparent",
            "transition-colors duration-150",
            "hover:bg-gray-100 hover:border-gray-200",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600",
            "cursor-copy"
          )}
        >
          {content}
        </button>

        {/* Live region for screen reader copy confirmation */}
        <span
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
        >
          {copied ? `${label} copié dans le presse-papier` : ""}
        </span>
      </div>
    )
  }

  // Non-copyable: static display
  return (
    <div
      className={cn(
        "rounded-lg bg-gray-50 px-3 py-2.5",
        className
      )}
    >
      {content}
    </div>
  )
}

export { DiabeoReadonlyField }
