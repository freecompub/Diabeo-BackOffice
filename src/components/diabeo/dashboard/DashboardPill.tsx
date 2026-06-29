import { cn } from "@/lib/utils"
import { Acronym, type AcronymCode } from "@/components/diabeo/Acronym"

/**
 * DashboardPill — petite pastille d'état colorée des cartes « Home v3 »
 * (cf. docs/mockups/home-roles-v3.html). Comble les variantes manquantes du
 * `Badge` shadcn (qui n'expose que default/secondary/destructive/outline) en
 * s'appuyant sur les tokens du design system (`feedback-*`, `pathology-*`,
 * accent de rôle). JAMAIS de couleur en dur — uniquement des classes
 * sémantiques (cf. CLAUDE.md §design system).
 *
 * Présentationnel pur (aucun hook) → rend aussi bien côté serveur que dans une
 * carte « use client ». L'information n'est jamais portée par la seule couleur :
 * le libellé textuel reste lisible (a11y `color-is-not-the-only-indicator`).
 */

export type DashboardPillVariant =
  | "error"
  | "warning"
  | "success"
  | "info"
  | "accent"
  | "dt1"
  | "dt2"
  | "gd"

const VARIANT_CLASSES: Record<DashboardPillVariant, string> = {
  error: "bg-feedback-error-bg text-feedback-error border-feedback-error/25",
  warning: "bg-feedback-warning-bg text-feedback-warning border-feedback-warning/25",
  success: "bg-feedback-success-bg text-feedback-success border-feedback-success/25",
  info: "bg-feedback-info-bg text-feedback-info border-feedback-info/25",
  accent: "bg-role-soft text-role-text border-role-line",
  dt1: "bg-pathology-dt1-bg text-pathology-dt1 border-pathology-dt1/25",
  dt2: "bg-pathology-dt2-bg text-pathology-dt2 border-pathology-dt2/25",
  gd: "bg-pathology-gd-bg text-pathology-gd border-pathology-gd/25",
}

export interface DashboardPillProps {
  variant: DashboardPillVariant
  children: React.ReactNode
  /** Optional accessible label when the visible text is an abbreviation. */
  "aria-label"?: string
  className?: string
}

export function DashboardPill({
  variant,
  children,
  className,
  ...rest
}: DashboardPillProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-bold",
        VARIANT_CLASSES[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  )
}

/** pathology (DT1/DT2/GD) → variante de pill. */
const PATHOLOGY_VARIANT = { DT1: "dt1", DT2: "dt2", GD: "gd" } as const

/**
 * Pill de pathologie (DT1/DT2/GD) — rend l'acronyme via `<Acronym>` (libellé
 * glossaire en infobulle, conforme CLAUDE.md §Acronymes) dans une pastille
 * colorée par pathologie. Le soulignement pointillé d'`Acronym` est retiré
 * (la pill porte déjà l'affordance visuelle). `null` si pathologie inconnue.
 */
export function PathologyPill({ pathology }: { pathology: string | null }) {
  if (pathology !== "DT1" && pathology !== "DT2" && pathology !== "GD") return null
  return (
    <DashboardPill variant={PATHOLOGY_VARIANT[pathology]}>
      <Acronym
        code={pathology as AcronymCode}
        className="cursor-help no-underline decoration-transparent"
      />
    </DashboardPill>
  )
}
