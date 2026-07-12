/**
 * @module insulin/slot-baseline-cas
 * @description US-2663 (S1) — Compare-and-swap **d'ensemble** de la base d'une proposition groupée.
 *
 * Garde-fou MDR anti « dérive de base » : à l'acceptation d'une `SlotSetProposal`, la disposition ACTIVE
 * (live) du patient doit être **identique** au snapshot `baselineSlots` pris à la génération. Si un ajustement
 * MÉDECIN concurrent (ex. baisse post-hypo) a bougé la base entre la génération et l'acceptation, appliquer
 * aveuglément le jeu proposé **écraserait** cet ajustement — c'est le risque clinique que S1 referme.
 *
 * **Sémantique S1 = CAS D'ENSEMBLE fail-closed** (D4, option recommandée) : toute divergence (valeur,
 * bornes, structure) entre live et baseline rejette la disposition ENTIÈRE (`baselineMoved`) → la proposition
 * reste `pending` et devra être **régénérée** sur la base à jour. Le diff-merge valeur-par-valeur (n'appliquer
 * que les créneaux réellement modifiés, laisser intacts les créneaux portés-inchangés) est une optimisation
 * différée (S1bis). Un snapshot **absent** (`null`, proposition legacy pré-US-2663) ⇒ base non vérifiable ⇒
 * `baselineMissing` (fail-closed : on n'applique jamais une dose sur une base qu'on ne peut pas certifier).
 *
 * Comparaison **pure** (aucune I/O), **appariée par clé `startHour`** (pas par position — un profil peut être
 * ré-ordonné sans changer de dose). `value` comparé avec une tolérance flottante (le round-trip JSON↔Number
 * est exact pour ces décimaux, la tolérance couvre toute reconstruction indirecte). `mealLabel` (ICR) est une
 * **étiquette d'affichage non dosante** → ignoré pour la détection de dérive (un simple relibellé ne bloque pas).
 *
 * @see docs/UserStory/insulinotherapie-edition/US-2663-EPIC-proposition-groupee-integrale.md (S1, garde-fou #2)
 * @see docs/clinical-logic/regles-et-constantes-diabete.md §6
 */
import type { IsfIcrSlot } from "@/lib/insulin/grouped-proposal"

/**
 * Tolérance de comparaison des valeurs de ratio (g/L·U ISF, g/U ICR). Les valeurs baseline (JSON) et live
 * (`Number(Decimal)`) proviennent de la même colonne source → égalité exacte attendue ; `1e-9` couvre la
 * représentation flottante sans jamais masquer un vrai changement clinique (le plus petit pas ISF est ~1e-2).
 */
export const BASELINE_VALUE_EPS = 1e-9

/**
 * Vérifie que la base LIVE est identique au snapshot `baselineSlots` (CAS d'ensemble). Lève un code d'erreur
 * métier stable (mappé en **409** par la route d'acceptation) si la base a bougé ou est invérifiable.
 *
 * Les `value` sont supposées FINIES par construction (`baseline` validé `finite().positive()` par `parseSlots` ;
 * `live` issu de `Number(Decimal)` d'une colonne numérique). Par sûreté, une valeur non finie est traitée
 * comme une dérive (`baselineMoved`) — jamais comme « inchangée » (garde anti fail-open sur `NaN > EPS === false`).
 *
 * @param baseline - snapshot pris à la génération (`SlotSetProposal.baselineSlots`) ; `null` = proposition legacy.
 * @param live - disposition ISF/ICR actuellement active du patient (lue sous verrou dans la transaction d'accept).
 * @throws baselineMissing  si `baseline === null` (base non certifiable → fail-closed).
 * @throws baselineMoved    si live diverge de baseline (cardinalité, borne, valeur, ou valeur non finie).
 */
export function assertBaselineUnchanged(
  baseline: readonly IsfIcrSlot[] | null,
  live: readonly IsfIcrSlot[],
): void {
  if (baseline === null) throw new Error("baselineMissing")
  if (baseline.length !== live.length) throw new Error("baselineMoved")

  // Appariement par clé `startHour` (pas par position — un profil peut être ré-ordonné sans changer de dose).
  // Un `startHour` en doublon dans `live` violerait l'invariant no-overlap (`assertValidSlotSet`, inatteignable
  // en prod) ; s'il survenait, la dernière entrée écrase — rattrapé fail-closed par le check de cardinalité +
  // un `b.startHour` alors orphelin → `baselineMoved`.
  const liveByStart = new Map(live.map((s) => [s.startHour, s]))
  for (const b of baseline) {
    const l = liveByStart.get(b.startHour)
    if (!l) throw new Error("baselineMoved") // créneau supprimé/déplacé (dérive de structure)
    if (l.endHour !== b.endHour) throw new Error("baselineMoved") // borne de fin déplacée
    // Garde fail-closed : une valeur non finie (NaN/Infinity — JSON corrompu, colonne invalide) N'EST PAS
    // « inchangée » ; `NaN > EPS` vaut `false`, donc on ne peut pas se reposer sur la seule comparaison d'écart.
    if (!Number.isFinite(l.value) || !Number.isFinite(b.value)) throw new Error("baselineMoved")
    if (Math.abs(l.value - b.value) > BASELINE_VALUE_EPS) throw new Error("baselineMoved") // valeur ajustée
    // `mealLabel` volontairement ignoré : étiquette d'affichage non dosante (un relibellé n'est pas une dérive).
  }
}
