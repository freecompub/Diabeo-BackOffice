import Link from "next/link"
import { cn } from "@/lib/utils"

/**
 * DashboardRow + DashboardAvatar — ligne de carte « Home v3 » (cf.
 * docs/mockups/home-roles-v3.html §médecin) : élément de gauche (avatar teinté
 * ou heure), bloc titre + sous-ligne, puis contenu trailing (pills, bouton,
 * horodatage).
 *
 * Présentationnel pur (aucun hook). L'avatar est `aria-hidden` (les initiales
 * dupliquent un nom déjà lu dans le titre) ; il n'expose jamais de couleur
 * comme seul porteur d'information.
 */

export type DashboardAvatarTint =
  | "error"
  | "warning"
  | "info"
  | "success"
  | "accent"
  | "neutral"

const TINT_CLASSES: Record<DashboardAvatarTint, string> = {
  error: "bg-feedback-error-bg text-feedback-error",
  warning: "bg-feedback-warning-bg text-feedback-warning",
  info: "bg-feedback-info-bg text-feedback-info",
  success: "bg-feedback-success-bg text-feedback-success",
  accent: "bg-role-soft text-role-text",
  neutral: "bg-muted text-foreground",
}

export function DashboardAvatar({
  initials,
  tint = "neutral",
  className,
}: {
  initials: string
  tint?: DashboardAvatarTint
  className?: string
}) {
  return (
    <span
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold",
        TINT_CLASSES[tint],
        className,
      )}
      aria-hidden="true"
    >
      {initials}
    </span>
  )
}

export interface DashboardRowProps {
  /** Élément de tête : `DashboardAvatar`, une heure, une icône… */
  leading?: React.ReactNode
  title: React.ReactNode
  sub?: React.ReactNode
  /** Pills + bouton + horodatage, alignés à droite. */
  trailing?: React.ReactNode
  className?: string
}

export function DashboardRow({
  leading,
  title,
  sub,
  trailing,
  className,
}: DashboardRowProps) {
  return (
    <li
      className={cn(
        "flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5",
        className,
      )}
    >
      {leading}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-foreground">{title}</div>
        {sub && <div className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</div>}
      </div>
      {trailing && (
        <div className="flex shrink-0 items-center gap-2">{trailing}</div>
      )}
    </li>
  )
}

/**
 * Bouton-lien d'action d'une ligne (« Ouvrir », « Préparer », « Revoir »…).
 * `variant="primary"` = action mise en avant (1ʳᵉ ligne du mockup) : fond
 * `role-text` (ton accent foncé, primary-700) + `text-white` → contraste WCAG
 * AA ≥4.5:1 pour tous les rôles (le ton accent de base primary-600 échouait sur
 * le teal médecin). Cible tactile ≥ 28px de haut, focus visible hérité du shell.
 */
export function DashboardRowAction({
  href,
  children,
  variant = "default",
  "aria-label": ariaLabel,
}: {
  href: string
  children: React.ReactNode
  variant?: "default" | "primary"
  "aria-label"?: string
}) {
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className={cn(
        "inline-flex h-7 items-center rounded-md px-2.5 text-xs font-bold transition-colors",
        variant === "primary"
          ? "bg-role-text text-white hover:brightness-110"
          : "border border-border bg-card text-foreground hover:bg-role-soft hover:text-role-text",
      )}
    >
      {children}
    </Link>
  )
}
