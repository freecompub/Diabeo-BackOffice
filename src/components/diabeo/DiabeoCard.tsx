import { forwardRef } from "react"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

/**
 * DiabeoCard — Styled wrapper around shadcn Card with Diabeo design tokens.
 *
 * Provides three surface variants following the "Serenite Active" design system:
 * - elevated: white bg with shadow, lifts on hover (default)
 * - filled: neutral gray background, no shadow (less emphasis)
 * - outlined: white bg with explicit border, no shadow (subtle)
 *
 * The `clickable` flag enables hover/focus interaction affordances.
 * Suitable for patient records, metric panels, and content groupings.
 *
 * Server component — no client-side state required.
 */

export type DiabeoCardVariant = "elevated" | "filled" | "outlined"
export type DiabeoCardPadding = "none" | "sm" | "md" | "lg"

export interface DiabeoCardProps extends React.ComponentProps<typeof Card> {
  /** Surface style variant. Default: "elevated" */
  variant?: DiabeoCardVariant
  /** Internal padding scale. Overrides shadcn Card default py-4. Default: "md" */
  padding?: DiabeoCardPadding
  /** Adds cursor-pointer, hover shadow lift, and focus ring */
  clickable?: boolean
  /** Additional CSS classes */
  className?: string
  children?: React.ReactNode
}

const variantClasses: Record<DiabeoCardVariant, string> = {
  elevated: [
    "bg-card shadow-diabeo-sm",
    "hover:shadow-diabeo-md",
    "transition-shadow duration-200 ease-out",
  ].join(" "),
  filled: "bg-neutral-50 shadow-none ring-0",
  outlined: "bg-card shadow-none ring-0 border border-gray-200",
}

const paddingClasses: Record<DiabeoCardPadding, string> = {
  none: "p-0",
  sm: "p-3",
  md: "p-4",
  lg: "p-6",
}

/**
 * DiabeoCard renders a shadcn Card with Diabeo visual variants and optional
 * interactivity. Use it as the base surface for any medical data container.
 *
 * @example
 * // Clickable elevated card for patient metrics
 * <DiabeoCard variant="elevated" clickable onClick={handleClick}>
 *   <PatientMetricContent />
 * </DiabeoCard>
 *
 * @example
 * // Filled card with no shadow for secondary content
 * <DiabeoCard variant="filled" padding="lg">
 *   <AdditionalNotes />
 * </DiabeoCard>
 */
export const DiabeoCard = forwardRef<HTMLDivElement, DiabeoCardProps>(
  function DiabeoCard(
    {
      variant = "elevated",
      padding = "md",
      clickable = false,
      className,
      children,
      ...props
    },
    ref
  ) {
    return (
      <Card
        ref={ref}
        className={cn(
          // Reset shadcn default gap/py since we apply padding explicitly
          "gap-0 py-0",
          variantClasses[variant],
          paddingClasses[padding],
          clickable && [
            "cursor-pointer",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600",
            "active:scale-[0.99] active:transition-transform",
          ],
          className
        )}
        {...props}
      >
        {children}
      </Card>
    )
  }
)

DiabeoCard.displayName = "DiabeoCard"
