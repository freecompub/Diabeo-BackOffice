/**
 * @module insulin/slot-diff
 * @description US-2663 (S2) — DIFF pur (ancien → nouveau) entre une disposition ISF/ICR LIVE et une
 * disposition PROPOSÉE (`SlotSetProposal.proposedSlots`), pour l'écran de revue médecin
 * (`/patients/[id]/review`, composant `GroupedProposalReview`).
 *
 * Contrairement au CAS d'ensemble (`slot-baseline-cas.ts`, qui compare `baselineSlots` — le snapshot pris À LA
 * GÉNÉRATION — au live, pour bloquer une acceptation sur base dérivée), ce module compare le live COURANT au
 * jeu PROPOSÉ, pour construire un tableau de diff surligné à afficher (chaque créneau proposé annoté de sa
 * valeur live actuelle et d'un indicateur `changed`). Usage strictement AFFICHAGE — aucune décision clinique
 * n'est prise ici.
 *
 * Appariement par clé `startHour` (comme le CAS d'ensemble) — un profil peut être ré-ordonné sans changer de
 * dose. Pas de PHI : valeurs de configuration (ratios), jamais de donnée de santé.
 *
 * @see src/lib/insulin/slot-baseline-cas.ts (CAS d'ensemble bloquant, baseline vs live)
 * @see docs/UserStory/insulinotherapie-edition/US-2663-EPIC-proposition-groupee-integrale.md (S2)
 */
import type { IsfIcrSlot } from "@/lib/insulin/grouped-proposal"
import { BASELINE_VALUE_EPS } from "@/lib/insulin/slot-baseline-cas"

/** Une ligne du tableau de diff : un créneau PROPOSÉ (ou un créneau LIVE **supprimé** par la proposition). */
export type SlotDiffRow = {
  startHour: number
  endHour: number
  /** Valeur proposée ; `null` = créneau LIVE **supprimé** (présent en live, absent du proposé, `removed=true`). */
  proposedValue: number | null
  /** Valeur live appariée par `startHour` ; `null` = **nouveau** créneau (absent de la config live). */
  liveValue: number | null
  mealLabel?: string
  /** `true` si live absent (nouveau), borne de fin différente, valeur différente (tolérance `BASELINE_VALUE_EPS`), ou supprimé. */
  changed: boolean
  /** `true` = créneau LIVE supprimé par la proposition (n'existe plus dans le jeu proposé). */
  removed: boolean
}

/**
 * Construit le diff (live → proposé), une ligne PAR CRÉNEAU PROPOSÉ, triées par `startHour`.
 *
 * @param live - disposition ISF/ICR actuellement active du patient (lue serveur, `page.tsx`).
 * @param proposed - disposition proposée (`SlotSetProposal.proposedSlots`, parsée).
 * @returns une ligne par créneau proposé, PLUS une ligne par créneau LIVE **supprimé** (présent en live,
 * absent du proposé — `proposedValue: null`, `removed: true`) ; le tout trié par `startHour`. Le médecin voit
 * ainsi explicitement les ajouts (`liveValue: null`) ET les suppressions (`proposedValue: null`).
 */
export function diffSlots(live: readonly IsfIcrSlot[], proposed: readonly IsfIcrSlot[]): SlotDiffRow[] {
  const liveByStart = new Map(live.map((s) => [s.startHour, s]))
  const proposedStarts = new Set(proposed.map((s) => s.startHour))

  const proposedRows: SlotDiffRow[] = proposed.map((p) => {
    const match = liveByStart.get(p.startHour)
    const liveValue = match ? match.value : null
    const changed =
      match === undefined ||
      match.endHour !== p.endHour ||
      !Number.isFinite(match.value) ||
      Math.abs(match.value - p.value) > BASELINE_VALUE_EPS
    return {
      startHour: p.startHour,
      endHour: p.endHour,
      proposedValue: p.value,
      liveValue,
      ...(p.mealLabel !== undefined ? { mealLabel: p.mealLabel } : {}),
      changed,
      removed: false,
    }
  })

  // Créneaux LIVE supprimés par la proposition (aucune correspondance `startHour` côté proposé) : rendus
  // explicitement (valeur live → « supprimé ») pour ne pas cacher une plage horaire qui perd sa dose dédiée.
  const removedRows: SlotDiffRow[] = live
    .filter((s) => !proposedStarts.has(s.startHour))
    .map((s) => ({
      startHour: s.startHour,
      endHour: s.endHour,
      proposedValue: null,
      liveValue: s.value,
      ...(s.mealLabel !== undefined ? { mealLabel: s.mealLabel } : {}),
      changed: true,
      removed: true,
    }))

  return [...proposedRows, ...removedRows].sort((a, b) => a.startHour - b.startHour)
}

/**
 * Détecte une dérive STRUCTURELLE entre live et proposé : cardinalité différente, OU un créneau live existe
 * mais n'a pas de correspondance (par `startHour`) dans le proposé (créneau supprimé/déplacé par la
 * proposition). Complète `diffSlots` (qui ne montre que les lignes du côté proposé) pour signaler une
 * suppression de créneau que le diff seul ne rend pas visible.
 */
export function hasStructuralChange(live: readonly IsfIcrSlot[], proposed: readonly IsfIcrSlot[]): boolean {
  if (live.length !== proposed.length) return true
  const proposedStarts = new Set(proposed.map((s) => s.startHour))
  return live.some((s) => !proposedStarts.has(s.startHour))
}
