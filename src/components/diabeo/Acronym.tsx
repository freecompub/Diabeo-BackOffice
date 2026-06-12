"use client"

/**
 * Acronym — affiche un acronyme métier accompagné de son libellé complet.
 *
 * Convention Diabeo (cf. CLAUDE.md §Acronymes) : aucun acronyme nu côté client.
 * Ce composant réalise le format **préféré** « acronyme + infobulle » : il rend
 * l'acronyme visuellement court, et expose le libellé complet en `Tooltip`
 * (survol + focus clavier) ET en `aria-label` pour les lecteurs d'écran.
 *
 * Les libellés vivent dans le namespace i18n `glossary` (FR/EN/AR) — source
 * unique. Pour les contextes NON-composant (acronyme noyé dans une phrase i18n),
 * ne pas utiliser ce composant : écrire « Libellé (ACRONYME) » directement dans
 * la chaîne traduite.
 *
 * @example
 *   <Acronym code="TIR" />            // → "TIR" + infobulle "Temps dans la cible"
 *   <Acronym code="TIR">TIR moyen</Acronym>  // libellé déclencheur custom
 *
 * Nécessite un `TooltipProvider` ancêtre (fourni par DataSummaryGrid / layouts).
 */

import type { ReactNode } from "react"
import { useTranslations } from "next-intl"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/**
 * Acronymes connus du glossaire. Garde-fou : ajouter une entrée ici ET dans
 * `messages/*.json` → `glossary.<CODE>` avant d'utiliser un nouveau code.
 * Liste runtime (consommée par `tests/unit/acronyms.test.ts` pour vérifier la
 * complétude du glossaire dans les 3 langues).
 */
export const ACRONYM_CODES = [
  // Médical
  "TIR", "CGM", "BGM", "IOB", "FSI", "RIG", "ISF", "ICR",
  "AGP", "HbA1c", "CV", "GMI", "DT1", "DT2", "GD", "ADA",
  // Réglementaire
  "RGPD", "HDS", "MFA", "INS", "NIRPP",
  // Métier
  "KPI", "IDE", "HDJ",
] as const

export type AcronymCode = (typeof ACRONYM_CODES)[number]

export interface AcronymProps {
  /** Code de l'acronyme — doit exister dans le namespace i18n `glossary`. */
  code: AcronymCode
  /**
   * Texte déclencheur affiché. Par défaut = le code lui-même. Permet
   * « TIR moyen » tout en gardant l'infobulle sur le libellé complet.
   */
  children?: ReactNode
  /** Classe optionnelle sur le déclencheur. */
  className?: string
}

export function Acronym({ code, children, className }: AcronymProps) {
  const t = useTranslations("glossary")
  const label = t(code as Parameters<typeof t>[0])

  return (
    // Provider intégré → le composant est autonome (utilisable sur n'importe
    // quelle page sans TooltipProvider ancêtre).
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          // Rendu en `<abbr>` (élément natif "abréviation + expansion") plutôt
          // qu'un `<button>` : sémantiquement correct pour un acronyme NON
          // actionnable (revue a11y PR #534). `tabIndex={0}` → l'infobulle reste
          // atteignable au clavier (WCAG 1.4.13). `aria-label` porte le libellé
          // complet aux lecteurs d'écran ; `cursor-help` + soulignement pointillé
          // signalent l'infobulle au survol.
          render={<abbr />}
          tabIndex={0}
          aria-label={`${label} (${code})`}
          className={`cursor-help underline decoration-dotted decoration-muted-foreground/70 underline-offset-2 ${className ?? ""}`}
        >
          {children ?? code}
        </TooltipTrigger>
        <TooltipContent side="top" align="start" className="max-w-xs text-xs">
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
