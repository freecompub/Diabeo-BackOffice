/**
 * DiabeoFormSection — Semantic fieldset wrapper for grouping related form fields.
 *
 * Renders an HTML <fieldset> with a <legend> for the title, which is the
 * semantically correct pattern for grouping controls in forms. Screen readers
 * announce the legend when the user moves focus into the group.
 *
 * Used throughout the Diabeo BackOffice to organize dense clinical forms:
 * patient demographics, insulin therapy settings, RGPD preferences, etc.
 *
 * Layout:
 *   ┌─ Title (18px semibold) ────────────────────┐
 *   │  Optional description (13px muted)         │
 *   │                                            │
 *   │  [child field 1]                           │
 *   │  [child field 2]                           │
 *   └────────────────────────────────────────────┘
 *
 * @example
 * // Patient contact form section
 * <DiabeoFormSection
 *   title="Coordonnées du patient"
 *   description="Informations de contact chiffrées AES-256-GCM"
 * >
 *   <DiabeoTextField label="Prénom" required />
 *   <DiabeoTextField label="Nom" required />
 *   <DiabeoTextField label="Téléphone" type="tel" />
 * </DiabeoFormSection>
 *
 * @example
 * // RGPD consent section
 * <DiabeoFormSection
 *   title="Consentements RGPD"
 *   description="Le patient doit accepter avant toute utilisation des données"
 * >
 *   <DiabeoToggle label="Consentement général" checked={...} onCheckedChange={...} />
 *   <DiabeoToggle label="Partage recherche médicale" checked={...} onCheckedChange={...} />
 * </DiabeoFormSection>
 *
 * Accessibility:
 * - <fieldset> + <legend> is the WCAG-recommended pattern for form groups
 * - Screen readers announce the legend title on field focus within the group
 * - Description is rendered as a <p> inside the fieldset (not the legend)
 *   to avoid verbosity on every field focus
 *
 * Note: Server Component — no "use client" directive.
 * Any interactivity must live in child components.
 */

import * as React from "react"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DiabeoFormSectionProps {
  /**
   * Section heading. Rendered as the <legend> of the fieldset.
   * Announced by screen readers when focus enters the group.
   */
  title: string

  /**
   * Optional supplementary description below the title.
   * Use to explain the purpose or constraints of the field group
   * (e.g., "Champs chiffrés — ne pas saisir de données fictives").
   */
  description?: string

  /**
   * Form fields and other children rendered with a vertical gap-4 spacing.
   */
  children: React.ReactNode

  /**
   * Additional CSS classes for the outer <fieldset> element.
   */
  className?: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * DiabeoFormSection
 *
 * Server Component. Wrap in a <form> or place inside a form context.
 * Do not use for non-form content grouping — use a <section> instead.
 */
function DiabeoFormSection({
  title,
  description,
  children,
  className,
}: DiabeoFormSectionProps) {
  return (
    <fieldset
      className={cn(
        "flex flex-col gap-4",
        // Remove default fieldset border/padding
        "min-w-0 border-0 p-0 m-0",
        className
      )}
    >
      {/* ----------------------------------------------------------------
       * Legend — announced by AT when focus enters the fieldset
       * -------------------------------------------------------------- */}
      <legend className="float-none w-full p-0">
        <span
          className={cn(
            "block text-lg font-semibold leading-snug text-foreground"
          )}
        >
          {title}
        </span>
        {description && (
          <p className="mt-1 text-xs leading-normal text-muted-foreground">
            {description}
          </p>
        )}
      </legend>

      {/* ----------------------------------------------------------------
       * Fields
       * -------------------------------------------------------------- */}
      <div className="flex flex-col gap-4">
        {children}
      </div>
    </fieldset>
  )
}

export { DiabeoFormSection }
