"use client"

import { useTranslations } from "next-intl"

/**
 * DiabeoTextField — Accessible text input with label, error, hint, and icon support.
 *
 * Wraps shadcn/ui Input + Label with Diabeo design system conventions for
 * clinical forms (patient data entry, medical settings, authentication).
 *
 * Features:
 * - Required indicator (*) with aria-required
 * - Optional leading icon (visually inside the input, left-padded)
 * - Password type with eye/eye-off toggle to show/hide the value
 * - Error state: red border + aria-invalid + red error message below
 * - Hint message below input (grayed) when no error is present
 * - aria-describedby links field to error/hint for screen readers
 *
 * @example
 * // Standard email field
 * <DiabeoTextField
 *   label="Adresse email"
 *   type="email"
 *   required
 *   icon={<Mail />}
 *   error={errors.email}
 * />
 *
 * @example
 * // Password with toggle
 * <DiabeoTextField
 *   label="Mot de passe"
 *   type="password"
 *   required
 * />
 *
 * Accessibility:
 * - label htmlFor matches input id (auto-generated from label when no id given)
 * - aria-describedby references error or hint element id
 * - aria-invalid="true" when error is present
 * - aria-required on the input element
 * - Password toggle button: aria-label "Afficher/Masquer le mot de passe"
 *
 * @see src/components/ui/input.tsx — shadcn/ui base input
 * @see src/components/ui/label.tsx — shadcn/ui base label
 */

import * as React from "react"
import { Eye, EyeOff } from "lucide-react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DiabeoTextFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "id"> {
  /**
   * Visible label rendered above the input.
   */
  label: string

  /**
   * When provided, the field is in error state:
   * - red border on the input
   * - red text below the input
   * - aria-invalid="true" on the input
   */
  error?: string

  /**
   * Supplementary hint rendered below the input in muted color.
   * Suppressed when an error is present.
   */
  hint?: string

  /**
   * Optional ReactNode rendered inside the input on the left side.
   * The input gets extra left padding to avoid text overlapping the icon.
   */
  icon?: React.ReactNode

  /**
   * Overrides the auto-generated input id.
   * Useful when the same label text appears multiple times on a page.
   */
  id?: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * DiabeoTextField
 *
 * Stable forwardRef component. The ref is forwarded to the underlying
 * <input> element for form library compatibility (react-hook-form, etc.).
 */
const DiabeoTextField = React.forwardRef<
  HTMLInputElement,
  DiabeoTextFieldProps
>(
  (
    {
      label,
      error,
      hint,
      icon,
      id,
      type = "text",
      required,
      className,
      ...props
    },
    ref
  ) => {
    // -----------------------------------------------------------------------
    // i18n for password toggle aria-label
    // -----------------------------------------------------------------------
    const tAuth = useTranslations("auth")

    // -----------------------------------------------------------------------
    // Password visibility toggle
    // -----------------------------------------------------------------------
    const [showPassword, setShowPassword] = React.useState(false)
    const isPassword = type === "password"
    const inputType = isPassword && showPassword ? "text" : type

    // -----------------------------------------------------------------------
    // Stable IDs for a11y linkage (label ↔ input, input ↔ error/hint)
    // -----------------------------------------------------------------------
    const generatedId = React.useId()
    const inputId = id ?? `diabeo-field-${generatedId}`
    const errorId = `${inputId}-error`
    const hintId = `${inputId}-hint`

    const hasError = Boolean(error)
    const hasHint = Boolean(hint) && !hasError
    const describedBy =
      hasError ? errorId : hasHint ? hintId : undefined

    return (
      <div className={cn("flex flex-col gap-1.5", className)}>
        {/* ----------------------------------------------------------------
         * Label
         * -------------------------------------------------------------- */}
        <Label htmlFor={inputId}>
          {label}
          {required && (
            <span
              className="ms-0.5 text-feedback-error"
              aria-hidden="true"
            >
              *
            </span>
          )}
        </Label>

        {/* ----------------------------------------------------------------
         * Input wrapper — relative so icon + eye button can be positioned
         * -------------------------------------------------------------- */}
        <div className="relative">
          {/* Leading icon */}
          {icon && (
            <span
              className={cn(
                "pointer-events-none absolute inset-y-0 start-2.5",
                "flex items-center text-muted-foreground",
                "[&_svg]:size-4"
              )}
              aria-hidden="true"
            >
              {icon}
            </span>
          )}

          <Input
            ref={ref}
            id={inputId}
            type={inputType}
            required={required}
            aria-required={required}
            aria-invalid={hasError || undefined}
            aria-describedby={describedBy}
            className={cn(
              // Inline-start padding bump when icon is present
              icon && "ps-9",
              // Inline-end padding bump for password toggle
              isPassword && "pe-9",
              // Error state overrides default ring
              hasError && [
                "border-feedback-error",
                "focus-visible:border-feedback-error",
                "focus-visible:ring-feedback-error/20",
              ]
            )}
            {...props}
          />

          {/* Password visibility toggle */}
          {isPassword && (
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={
                showPassword
                  ? tAuth("hidePassword")
                  : tAuth("showPassword")
              }
              className={cn(
                "absolute inset-y-0 end-2.5 flex items-center",
                "text-muted-foreground transition-colors",
                "hover:text-foreground",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600",
                "[&_svg]:size-4"
              )}
            >
              {showPassword ? <EyeOff /> : <Eye />}
            </button>
          )}
        </div>

        {/* ----------------------------------------------------------------
         * Error message
         * -------------------------------------------------------------- */}
        {hasError && (
          <p
            id={errorId}
            role="alert"
            className="text-xs font-medium text-feedback-error"
          >
            {error}
          </p>
        )}

        {/* ----------------------------------------------------------------
         * Hint message — only when no error
         * -------------------------------------------------------------- */}
        {hasHint && (
          <p
            id={hintId}
            className="text-xs text-muted-foreground"
          >
            {hint}
          </p>
        )}
      </div>
    )
  }
)

DiabeoTextField.displayName = "DiabeoTextField"

export { DiabeoTextField }
