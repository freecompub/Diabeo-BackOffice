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
// Fix CR-5 round 1 review PR #436 — single source of truth client+serveur
// pour éviter drift TTL entre backend gate `alternativeExpired` 422 et UI count.
import { PROPOSAL_TTL_MS } from "@/lib/rdv-constants"

/**
 * Fix FE-5 round 1 review PR #436 — `now` REQUIS en paramètre (vs default
 * `Date.now()` qui violait React-Compiler "Cannot call impure function during
 * render"). Le caller calcule `now` une fois via `useMemo` ou `useState` et
 * le propage stable, ce qui permet la mémoisation correcte et les tests
 * déterministes (mock `Date.now` non requis).
 */
export function countPendingAlternatives(
  items: ReadonlyArray<AppointmentListItem>,
  now: number,
): number {
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
   * Fix FE-5 round 1 review PR #436 — `now` REQUIS en prop (vs `Date.now()`
   * en body refusé par React-Compiler). Le parent passe typiquement
   * `lastFetchedAt?.getTime() ?? Date.now()` qui se met à jour à chaque
   * polling 60s — granularité TTL 7j largement suffisante.
   */
  now: number
  /**
   * Callback "Voir" : le parent applique un filtre pour ne montrer que les
   * alternatives en attente (filtre status=cancelled + proposedAlt non null).
   */
  onShowAlternatives: () => void
}

export function AlternativesBanner({
  items,
  now,
  onShowAlternatives,
}: AlternativesBannerProps) {
  const t = useTranslations("appointments")
  const count = countPendingAlternatives(items, now)

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
