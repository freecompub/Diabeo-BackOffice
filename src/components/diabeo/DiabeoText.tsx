import { forwardRef, type ElementType, type HTMLAttributes } from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/**
 * DiabeoText — Typography component with design token variants.
 *
 * Wraps semantic HTML elements with consistent typographic styles
 * derived from the Diabeo "Serenite Active" design system.
 *
 * Variants follow the type scale defined in `src/styles/tokens.css`.
 * Heading variants render semantic <h1>–<h3> by default (overridable via `as`).
 * Body/label/caption variants render <p>, <span>, or <span> by default.
 *
 * Accessibility: uses semantic HTML tags — no ARIA overrides needed.
 */

// ---------------------------------------------------------------------------
// CVA variant definitions
// ---------------------------------------------------------------------------

const textVariants = cva("", {
  variants: {
    variant: {
      /** 36px / bold — page-level display titles */
      displayLarge: "text-4xl font-bold leading-tight tracking-tight",
      /** 30px / bold — section display titles */
      displaySmall: "text-3xl font-bold leading-tight tracking-tight",
      /** 24px / semibold — card or section headings */
      headingLarge: "text-2xl font-semibold leading-snug",
      /** 20px / semibold — sub-section headings */
      headingMedium: "text-xl font-semibold leading-snug",
      /** 18px / semibold — minor headings, panel titles */
      headingSmall: "text-lg font-semibold leading-snug",
      /** 16px / normal — primary readable body text */
      bodyLarge: "text-md font-normal leading-relaxed",
      /** 14px / normal — default body text (matches base body size) */
      bodyMedium: "text-base font-normal leading-normal",
      /** 13px / normal — secondary body text, helper text */
      bodySmall: "text-sm font-normal leading-normal",
      /** 16px / medium — interactive labels, form labels */
      labelLarge: "text-md font-medium leading-normal",
      /** 14px / medium — compact interactive labels */
      labelMedium: "text-base font-medium leading-normal",
      /** 12px / normal — captions, timestamps, footnotes */
      captionSmall: "text-xs font-normal leading-normal",
      /** 12px / normal / mono — chart axis labels, numeric codes */
      chartAxis: "text-xs font-normal leading-normal font-mono tabular-nums",
    },
    color: {
      /** Teal brand primary (#0D9488) */
      primary: "text-teal-600",
      /** Coral accent — WCAG compliant darker shade for normal text (#C2410C, 7.8:1) */
      secondary: "text-coral-700",
      /** Gray muted foreground (#6B7280) */
      muted: "text-muted-foreground",
      /** Red error (#EF4444) */
      error: "text-feedback-error",
      /** Green success (#10B981) */
      success: "text-feedback-success",
      /** Amber warning (#F59E0B) */
      warning: "text-feedback-warning",
    },
  },
  defaultVariants: {
    variant: "bodyMedium",
  },
})

// ---------------------------------------------------------------------------
// Default HTML tag per variant (semantic rendering)
// ---------------------------------------------------------------------------

const DEFAULT_TAG: Record<NonNullable<TextVariant>, ElementType> = {
  displayLarge: "h1",
  displaySmall: "h2",
  headingLarge: "h2",
  headingMedium: "h3",
  headingSmall: "h4",
  bodyLarge: "p",
  bodyMedium: "p",
  bodySmall: "p",
  labelLarge: "span",
  labelMedium: "span",
  captionSmall: "span",
  chartAxis: "span",
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TextVariant = VariantProps<typeof textVariants>["variant"]
type TextColor = VariantProps<typeof textVariants>["color"]

export interface DiabeoTextProps
  extends Omit<HTMLAttributes<HTMLElement>, "color"> {
  /** Typography scale variant */
  variant?: TextVariant
  /** Semantic color token */
  color?: TextColor
  /** Override the rendered HTML tag. Heading variants default to h1–h4. */
  as?: ElementType
  className?: string
  children?: React.ReactNode
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * DiabeoText renders typographic content with consistent design-system
 * variants, accessible semantic HTML, and optional color theming.
 *
 * @example
 * // Page title
 * <DiabeoText variant="displayLarge">Tableau de bord</DiabeoText>
 *
 * @example
 * // Muted caption with tag override
 * <DiabeoText variant="captionSmall" color="muted" as="time">
 *   Il y a 3 min
 * </DiabeoText>
 */
export const DiabeoText = forwardRef<HTMLElement, DiabeoTextProps>(
  function DiabeoText(
    { variant = "bodyMedium", color, as, className, children, ...props },
    ref
  ) {
    const Tag = as ?? DEFAULT_TAG[variant ?? "bodyMedium"]

    return (
      <Tag
        ref={ref}
        className={cn(textVariants({ variant, color }), className)}
        {...props}
      >
        {children}
      </Tag>
    )
  }
)

DiabeoText.displayName = "DiabeoText"

export { textVariants }
export type { TextVariant, TextColor }
