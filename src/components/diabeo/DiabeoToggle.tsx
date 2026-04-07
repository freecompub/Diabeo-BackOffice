"use client"

/**
 * DiabeoToggle — Accessible on/off toggle switch with label and optional subtitle.
 *
 * Used for binary settings in medical contexts: notifications, RGPD consents,
 * CGM alerts, treatment flags. Built as a native <button role="switch"> to
 * avoid dependency on a headless library while remaining fully accessible.
 *
 * Layout:
 *   [ Label text        ] [ ●○ ]
 *   [ Subtitle (muted)  ]
 *
 * The toggle thumb slides with a CSS transition. The track is teal-600 when
 * checked and gray-300 when unchecked, consistent with the "Serenite Active"
 * design system.
 *
 * @example
 * // RGPD consent toggle
 * <DiabeoToggle
 *   label="Partage avec l'équipe soignante"
 *   subtitle="Autorise votre médecin référent à consulter vos données"
 *   checked={privacySettings.shareWithTeam}
 *   onCheckedChange={(v) => updatePrivacy({ shareWithTeam: v })}
 * />
 *
 * @example
 * // Disabled — pending validation
 * <DiabeoToggle
 *   label="Notifications glycémiques"
 *   checked={false}
 *   onCheckedChange={() => {}}
 *   disabled
 * />
 *
 * Accessibility:
 * - role="switch" with aria-checked (true/false, not "mixed")
 * - aria-disabled when disabled
 * - Focus ring: teal-600 outline on focus-visible
 * - Subtitle linked via aria-describedby
 * - Keyboard: Space / Enter toggle the switch (native button behavior)
 *
 * @see WCAG 2.1 SC 4.1.2 — Name, Role, Value for custom controls
 */

import * as React from "react"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DiabeoToggleProps {
  /**
   * Primary label describing what the toggle controls.
   */
  label: string

  /**
   * Optional secondary description shown below the label in muted text.
   * Linked to the toggle via aria-describedby.
   */
  subtitle?: string

  /**
   * Current checked state. The component is fully controlled.
   */
  checked: boolean

  /**
   * Callback invoked with the new value when the user toggles.
   */
  onCheckedChange: (checked: boolean) => void

  /**
   * When true, the toggle cannot be interacted with and is visually dimmed.
   */
  disabled?: boolean

  /**
   * Additional CSS classes for the outer wrapper element.
   */
  className?: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * DiabeoToggle
 *
 * Fully controlled toggle switch. The parent is responsible for state.
 * Use with react-hook-form via the Controller pattern.
 */
function DiabeoToggle({
  label,
  subtitle,
  checked,
  onCheckedChange,
  disabled = false,
  className,
}: DiabeoToggleProps) {
  const id = React.useId()
  const labelId = `toggle-label-${id}`
  const subtitleId = subtitle ? `toggle-subtitle-${id}` : undefined

  const handleClick = () => {
    if (!disabled) {
      onCheckedChange(!checked)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    // Space is already handled by native button click, but Enter is not
    // default for role="switch" — we handle both explicitly for clarity.
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault()
      handleClick()
    }
  }

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4",
        disabled && "opacity-50",
        className
      )}
    >
      {/* ----------------------------------------------------------------
       * Text block — label + optional subtitle
       * -------------------------------------------------------------- */}
      <div className="flex min-w-0 flex-col gap-0.5">
        <span
          id={labelId}
          className="text-sm font-medium text-foreground leading-snug"
        >
          {label}
        </span>
        {subtitle && (
          <span
            id={subtitleId}
            className="text-xs text-muted-foreground leading-normal"
          >
            {subtitle}
          </span>
        )}
      </div>

      {/* ----------------------------------------------------------------
       * Toggle switch button
       * -------------------------------------------------------------- */}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={subtitleId}
        aria-disabled={disabled || undefined}
        disabled={disabled}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className={cn(
          // Track shape
          "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center",
          "rounded-full border-2 border-transparent",
          "transition-colors duration-200 ease-in-out",
          // Track color
          checked ? "bg-teal-600" : "bg-gray-300",
          // Focus ring
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600",
          // Disabled cursor
          disabled && "cursor-not-allowed"
        )}
      >
        {/* Thumb */}
        <span
          aria-hidden="true"
          className={cn(
            // Thumb shape
            "pointer-events-none inline-block size-5 rounded-full bg-white",
            // Shadow for depth
            "shadow-sm",
            // Slide animation (respects prefers-reduced-motion)
            "transition-transform duration-200 ease-in-out motion-reduce:transition-none",
            checked ? "translate-x-5" : "translate-x-0"
          )}
        />
      </button>
    </div>
  )
}

export { DiabeoToggle }
