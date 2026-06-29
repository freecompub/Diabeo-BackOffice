import Link from "next/link"
import { cn } from "@/lib/utils"

/**
 * DashboardCardHeader — en-tête de carte « Home v3 » (cf.
 * docs/mockups/home-roles-v3.html) : pastille d'état · titre Fraunces ·
 * compteur monospace · lien « Tout voir » optionnel.
 *
 * La pastille est purement décorative (`aria-hidden`) : l'état clinique reste
 * porté par le contenu des lignes et leurs libellés. Présentationnel (aucun
 * hook) → utilisable dans les cartes « use client ».
 */

export type DashboardCardHeaderDot = "error" | "warning" | "info" | "success" | "neutral"

const DOT_CLASSES: Record<DashboardCardHeaderDot, string> = {
  error: "bg-glycemia-critical",
  warning: "bg-glycemia-high",
  info: "bg-feedback-info",
  success: "bg-glycemia-normal",
  neutral: "bg-muted-foreground",
}

export interface DashboardCardHeaderProps {
  /** `id` câblé à `aria-labelledby` de la carte parente. */
  titleId: string
  title: string
  dot?: DashboardCardHeaderDot
  /** Compteur affiché en monospace (chiffre nu, ex. nombre d'éléments). */
  count?: number | string
  /** Lien « plus » aligné à droite (ex. « Tout voir » → /patients). */
  more?: { href: string; label: string }
  /** Contenu trailing alternatif (ex. « dernière maj » de l'EmergencyCard). */
  trailing?: React.ReactNode
  className?: string
}

export function DashboardCardHeader({
  titleId,
  title,
  dot = "info",
  count,
  more,
  trailing,
  className,
}: DashboardCardHeaderProps) {
  return (
    <header className={cn("flex items-center gap-2.5 px-4 pt-4", className)}>
      <span
        className={cn("h-2.5 w-2.5 shrink-0 rounded-full", DOT_CLASSES[dot])}
        aria-hidden="true"
      />
      <h2 id={titleId} className="font-display text-base font-semibold tracking-tight">
        {title}
      </h2>
      {count !== undefined && (
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {count}
        </span>
      )}
      {(more !== undefined || trailing !== undefined) && (
        <span className="ms-auto flex items-center gap-3">
          {trailing}
          {more && (
            <Link
              href={more.href}
              className="text-xs font-semibold text-role-text hover:underline"
            >
              {more.label}
            </Link>
          )}
        </span>
      )}
    </header>
  )
}
