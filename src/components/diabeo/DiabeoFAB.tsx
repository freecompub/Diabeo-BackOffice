"use client"

import { type ReactNode } from "react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

/**
 * DiabeoFAB — Floating Action Button for primary contextual actions.
 *
 * Positioned fixed in the bottom-trailing corner of the viewport (z-50).
 * Shows the action label as a tooltip on hover for discoverability.
 *
 * RTL support: uses `inset-inline-end` and `inset-block-end` so the button
 * appears bottom-right in LTR layouts and bottom-left in RTL (Arabic).
 *
 * Accessibility:
 * - `aria-label` is set to the `label` prop (visible only to AT and tooltip)
 * - Receives keyboard focus via the standard tab sequence
 * - Focus ring follows the teal brand color on both variants
 *
 * Use cases: "Ajouter un patient", "Nouveau rendez-vous", "Exporter".
 * Do not use more than one FAB per page — it competes with primary navigation.
 */

export type FabVariant = "primary" | "secondary"

export interface DiabeoFABProps {
  /** Icon to display centered in the button (e.g., Lucide <Plus />) */
  icon: ReactNode
  /** Accessible label — shown as tooltip and used as aria-label */
  label: string
  /** Called when the button is activated (click or keyboard) */
  onClick: () => void
  /** Visual variant. Primary = teal brand, secondary = coral accent. */
  variant?: FabVariant
  /** Additional CSS classes (e.g., to adjust position offset) */
  className?: string
}

const variantClasses: Record<FabVariant, string> = {
  primary: [
    "bg-teal-600 hover:bg-teal-700 active:bg-teal-800",
    "shadow-diabeo-primary",
    "focus-visible:outline-teal-600",
  ].join(" "),
  secondary: [
    "bg-coral-500 hover:bg-coral-600 active:bg-coral-700",
    "shadow-diabeo-warning",
    "focus-visible:outline-coral-500",
  ].join(" "),
}

/**
 * DiabeoFAB renders a 56×56px round button with tooltip, fixed at the
 * bottom-trailing corner. Supports LTR and RTL layouts.
 *
 * @example
 * <DiabeoFAB
 *   icon={<Plus className="h-6 w-6" />}
 *   label="Ajouter un patient"
 *   onClick={() => setOpenModal(true)}
 * />
 *
 * @example
 * // Secondary variant for export action
 * <DiabeoFAB
 *   variant="secondary"
 *   icon={<Download className="h-6 w-6" />}
 *   label="Exporter les donnees"
 *   onClick={handleExport}
 * />
 */
export function DiabeoFAB({
  icon,
  label,
  onClick,
  variant = "primary",
  className,
}: DiabeoFABProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          // base-ui Trigger renders as a button by default; we override its
          // styling completely to match our FAB spec.
          render={
            <button
              type="button"
              onClick={onClick}
              aria-label={label}
              className={cn(
                // Position: fixed at bottom-trailing corner, above page content
                "fixed z-50",
                // Use logical properties for RTL compatibility
                "bottom-6 end-6",
                // Size and shape
                "h-14 w-14 rounded-full",
                // Content centering
                "inline-flex items-center justify-center",
                // Icon color
                "text-white",
                // Shadow
                "shadow-diabeo-lg",
                // Transitions
                "transition-all duration-200 ease-out",
                "active:scale-95",
                // Focus ring
                "focus-visible:outline-2 focus-visible:outline-offset-2",
                variantClasses[variant],
                className
              )}
            >
              {/* Icon is 24px (h-6 w-6) by convention — enforce via wrapper */}
              <span className="[&>svg]:h-6 [&>svg]:w-6" aria-hidden="true">
                {icon}
              </span>
            </button>
          }
        />
        <TooltipContent side="left" sideOffset={8}>
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
