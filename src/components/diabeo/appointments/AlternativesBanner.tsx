"use client"

/**
 * AlternativesBanner — bandeau "Alternatives en attente d'acceptation".
 *
 * US-2500-UI iter 9 — Affiche un compteur des RDV qui ont une alternative
 * proposée par le DOCTOR (cf. iter 5 `submitProposeAlt`) mais pas encore
 * acceptée par le patient/staff.
 *
 * **Filtre** : RDV qui matchent TOUS les critères :
 *   - `status === "cancelled"` (l'original a été cancel pour proposer l'alt)
 *   - `proposedAlternativeAt !== null`
 *   - TTL non expiré (7j depuis proposition — cf. backend `PROPOSAL_TTL_MS`)
 *
 * **Interaction** :
 *   - Bouton "Voir" → filtre le calendar sur ces alternatives (callback parent)
 *   - Compteur dynamique mis à jour par polling 60s du hook `useAppointments`
 *
 * **A11y** : `role="region"` + `aria-label` + bouton touch target 44px.
 *
 * **Pattern visuel** : bande orange ambre (status pending_validation) pour
 * signaler attention sans criticité (vs rouge erreur).
 */

import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import type { AppointmentListItem } from "./useAppointments"

const PROPOSAL_TTL_MS = 7 * 24 * 3600 * 1000

export function countPendingAlternatives(items: ReadonlyArray<AppointmentListItem>): number {
  const now = Date.now()
  return items.filter(
    (it) =>
      it.status === "cancelled"
      && it.proposedAlternativeAt !== null
      && now - new Date(it.proposedAlternativeAt).getTime() < PROPOSAL_TTL_MS,
  ).length
}

export interface AlternativesBannerProps {
  /** Items du calendar (déjà filtrés par range/scope) — count appliqué dessus. */
  items: ReadonlyArray<AppointmentListItem>
  /**
   * Callback "Voir" : le parent applique un filtre pour ne montrer que les
   * alternatives en attente (filtre status=cancelled + proposedAlt non null).
   */
  onShowAlternatives: () => void
}

export function AlternativesBanner({ items, onShowAlternatives }: AlternativesBannerProps) {
  const t = useTranslations("appointments")
  const count = countPendingAlternatives(items)

  if (count === 0) return null

  return (
    <div
      role="region"
      aria-label={t("alternativesBannerLabel")}
      className="flex items-center justify-between gap-3 px-4 py-2 rounded-md border border-amber-500/40 bg-amber-50 text-amber-900"
    >
      <p className="text-sm">
        {t("alternativesBannerMessage", { count })}
      </p>
      <Button
        variant="outline"
        size="sm"
        onClick={onShowAlternatives}
        className="min-h-[44px] bg-white"
      >
        {t("alternativesBannerAction")}
      </Button>
    </div>
  )
}
