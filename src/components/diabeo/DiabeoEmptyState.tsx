"use client"

import { type ReactNode } from "react"
import { useTranslations } from "next-intl"
import {
  Database,
  Search,
  AlertTriangle,
  BarChart3,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { DiabeoButton } from "./DiabeoButton"

/**
 * DiabeoEmptyState — Empty state display for data areas in the Diabeo backoffice.
 *
 * Renders a vertically centered, accessible empty state with:
 * - A contextual icon (default per variant, overridable)
 * - A heading title
 * - A descriptive message
 * - An optional call-to-action button
 *
 * The `insufficientData` variant is clinically specific: it appears when there is
 * not enough CGM data to compute meaningful analytics (e.g., TIR requires at least
 * 70% of data over 14 days per AGP guidelines). The optional `threshold` prop lets
 * parent components show how much data has been collected.
 *
 * Uses next-intl for translatable defaults — all text can be overridden via props.
 */

export type EmptyStateVariant =
  | "noData"
  | "noSearchResults"
  | "error"
  | "insufficientData"

export interface EmptyStateAction {
  /** Button label */
  label: string
  /** Called when the button is clicked */
  onClick: () => void
}

export interface DiabeoEmptyStateProps {
  /** Controls default icon, title, and message */
  variant: EmptyStateVariant
  /** Override the default title for this variant */
  title?: string
  /** Override the default descriptive message for this variant */
  message?: string
  /** Override the default icon for this variant (ReactNode — e.g., Lucide icon at size 48) */
  icon?: ReactNode
  /** Optional call-to-action button */
  action?: EmptyStateAction
  /**
   * For the `insufficientData` variant: the current data coverage percentage (0–100).
   * If provided, shown in the message as context.
   */
  threshold?: number
  /** Additional CSS classes */
  className?: string
}

// ─── Default icons per variant ────────────────────────────────────────────────

const defaultIcons: Record<EmptyStateVariant, ReactNode> = {
  noData: <Database className="h-12 w-12" aria-hidden="true" />,
  noSearchResults: <Search className="h-12 w-12" aria-hidden="true" />,
  error: <AlertTriangle className="h-12 w-12" aria-hidden="true" />,
  insufficientData: <BarChart3 className="h-12 w-12" aria-hidden="true" />,
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Displays an empty or error state with icon, title, message, and optional action.
 * All text is i18n-aware via next-intl; override via title/message props if needed.
 *
 * @example
 * // No data after filtering
 * <DiabeoEmptyState variant="noSearchResults" />
 *
 * @example
 * // Insufficient CGM data with coverage info
 * <DiabeoEmptyState
 *   variant="insufficientData"
 *   threshold={45}
 *   action={{ label: "Connecter un appareil", onClick: openDeviceModal }}
 * />
 */
export function DiabeoEmptyState({
  variant,
  title: titleProp,
  message: messageProp,
  icon: iconProp,
  action,
  threshold,
  className,
}: DiabeoEmptyStateProps) {
  const t = useTranslations("emptyState")

  // Resolve defaults from i18n, falling back to a safe string if key is missing
  const defaultTitle: string = t(variant as Parameters<typeof t>[0])
  const defaultMessage: string =
    variant === "insufficientData" && threshold !== undefined
      ? t("insufficientDataMessage" as Parameters<typeof t>[0], { threshold: Math.round(threshold) })
      : t(`${variant}Message` as Parameters<typeof t>[0])

  const title = titleProp ?? defaultTitle
  const message = messageProp ?? defaultMessage
  const icon = iconProp ?? defaultIcons[variant]

  return (
    <div
      role="status"
      aria-label={title}
      className={cn(
        "flex flex-col items-center justify-center gap-4 py-12 px-6 text-center",
        className
      )}
    >
      {/* Icon */}
      <div className="text-muted-foreground/40" aria-hidden="true">
        {icon}
      </div>

      {/* Title */}
      <h3 className="text-lg font-semibold leading-snug text-foreground">
        {title}
      </h3>

      {/* Message */}
      <p className="text-sm font-normal leading-normal text-muted-foreground max-w-sm">
        {message}
      </p>

      {/* CTA */}
      {action && (
        <DiabeoButton
          variant="diabeoPrimary"
          onClick={action.onClick}
          className="mt-2"
        >
          {action.label}
        </DiabeoButton>
      )}
    </div>
  )
}
