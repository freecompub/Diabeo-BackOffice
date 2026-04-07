"use client"

/**
 * DiabeoButton — Primary interactive button component for the Diabeo BackOffice.
 *
 * Wraps the shadcn/ui Button primitive with Diabeo-specific variants from the
 * "Serenite Active" design system. Supports loading states (with spinner),
 * optional leading icon, and full-width layout.
 *
 * @example
 * // Primary action — save patient record
 * <DiabeoButton variant="diabeoPrimary" loading={isSaving}>
 *   Enregistrer
 * </DiabeoButton>
 *
 * @example
 * // Destructive action with icon — delete prescription
 * <DiabeoButton variant="diabeoDestructive" icon={<Trash2 />}>
 *   Supprimer
 * </DiabeoButton>
 *
 * Accessibility:
 * - Disabled when loading (aria-disabled propagated by base Button)
 * - Spinner has aria-hidden; visible label remains for screen readers
 * - Focus ring uses teal-600 per medical-grade focus policy
 *
 * @see src/components/ui/button.tsx — shadcn/ui base
 * @see src/styles/tokens.css — design tokens
 */

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Variant definitions
// ---------------------------------------------------------------------------

const diabeoButtonVariants = cva(
  [
    // Base styles
    "inline-flex shrink-0 items-center justify-center gap-2",
    "rounded-lg border border-transparent",
    "text-sm font-medium whitespace-nowrap",
    "transition-all duration-[var(--diabeo-duration-normal)]",
    "outline-none select-none",
    // Focus ring — teal-600 per medical-grade focus policy
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600",
    // Disabled state
    "disabled:pointer-events-none disabled:opacity-50",
    // Icon sizing
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
      variant: {
        /**
         * diabeoPrimary — Main call-to-action (teal).
         * Use for: Save, Confirm, Submit actions.
         */
        diabeoPrimary:
          "bg-teal-600 text-white hover:bg-teal-700 active:bg-teal-800",

        /**
         * diabeoSecondary — Secondary call-to-action (coral).
         * Use for: Alerts, secondary actions, warnings.
         */
        diabeoSecondary:
          "bg-coral-500 text-white hover:bg-coral-600 active:bg-coral-700",

        /**
         * diabeoTertiary — Low-emphasis action (transparent/teal).
         * Use for: Cancel, tertiary links, supplementary actions.
         */
        diabeoTertiary:
          "bg-transparent text-teal-600 border-teal-600 hover:bg-teal-50 active:bg-teal-100",

        /**
         * diabeoDestructive — Destructive irreversible action (red).
         * Use for: Delete, revoke, hard resets. Always confirm before.
         */
        diabeoDestructive:
          "bg-red-500 text-white hover:bg-red-600 active:bg-red-700",

        /**
         * diabeoGhost — No background, subtle hover.
         * Use for: Toolbar actions, icon-only buttons in dense UI.
         */
        diabeoGhost:
          "bg-transparent text-foreground hover:bg-muted hover:text-foreground active:bg-muted",
      },
      size: {
        sm: "h-7 px-2.5 text-xs",
        default: "h-9 px-4",
        lg: "h-11 px-6 text-base",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "diabeoPrimary",
      size: "default",
    },
  }
)

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DiabeoButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof diabeoButtonVariants> {
  /**
   * Shows a spinning loader and disables interaction.
   * Keeps the label visible for screen readers while indicating pending state.
   */
  loading?: boolean

  /**
   * Optional ReactNode rendered before the label with a gap-2 spacing.
   * Hidden when loading (replaced by the spinner).
   */
  icon?: React.ReactNode

  /**
   * Expands the button to fill its container width (w-full).
   */
  fullWidth?: boolean
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * DiabeoButton
 *
 * Medical-grade button component. Prefer explicit variant names over
 * default shadcn variants to keep intent readable in clinical UI code.
 */
const DiabeoButton = React.forwardRef<HTMLButtonElement, DiabeoButtonProps>(
  (
    {
      className,
      variant,
      size,
      loading = false,
      icon,
      fullWidth = false,
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || loading

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        className={cn(
          diabeoButtonVariants({ variant, size }),
          fullWidth && "w-full",
          className
        )}
        {...props}
      >
        {loading ? (
          <Loader2
            className="size-4 animate-spin"
            aria-hidden="true"
          />
        ) : (
          icon && (
            <span className="inline-flex shrink-0" aria-hidden="true">
              {icon}
            </span>
          )
        )}
        {children}
      </button>
    )
  }
)

DiabeoButton.displayName = "DiabeoButton"

export { DiabeoButton, diabeoButtonVariants }
