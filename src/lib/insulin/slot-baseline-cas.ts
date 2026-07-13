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
 * US-2663 (S3c/S3d) — CAS d'ensemble **générique par clé**, cœur partagé de tous les leviers groupés. La
 * disposition intégrale couvre 4 formes de créneaux qui ne s'apparient PAS toutes par `startHour` :
 *
 * | Levier            | `keyOf`      | `valueOf` | `boundEq` (dérive structurelle)     |
 * |-------------------|--------------|-----------|-------------------------------------|
 * | ISF / ICR         | `startHour`  | `value`   | `endHour` égal                      |
 * | basale POMPE      | `startTime`  | `rate`    | `endTime` égal                      |
 * | basale STYLO      | `kind`       | `value`   | — (pas de borne : dose ponctuelle)  |
 * | dose fixe         | `moment`     | `value`   | — (pas de borne : dose ponctuelle)  |
 *
 * Sémantique fail-closed inchangée (cf. `assertBaselineUnchanged`) : snapshot `null` → `baselineMissing` ;
 * toute divergence (cardinalité, borne, valeur, valeur non finie) → `baselineMoved`. Appariement par CLÉ (pas
 * par position — un jeu peut être ré-ordonné sans changer de dose). Comparaison PURE (aucune I/O).
 *
 * @param baseline - snapshot `SlotSetProposal.baselineSlots` ; `null` = proposition legacy (non certifiable).
 * @param live - disposition ACTIVE du patient (lue sous verrou dans la transaction d'accept).
 * @param opts.keyOf   - extracteur de la clé d'appariement (unique par créneau : `startHour`/`startTime`/`kind`/`moment`).
 * @param opts.valueOf - extracteur de la valeur dosante comparée (tolérance `BASELINE_VALUE_EPS`).
 * @param opts.boundEq - (optionnel) égalité de borne structurelle (ex. `endHour`/`endTime`) ; absent = pas de borne.
 * @throws baselineMissing  si `baseline === null`.
 * @throws baselineMoved    si live diverge de baseline (cardinalité, borne, valeur, ou valeur non finie).
 */
export function assertBaselineUnchangedBy<T>(
  baseline: readonly T[] | null,
  live: readonly T[],
  opts: {
    keyOf: (s: T) => string | number
    valueOf: (s: T) => number
    boundEq?: (live: T, baseline: T) => boolean
  },
): void {
  if (baseline === null) throw new Error("baselineMissing")
  if (baseline.length !== live.length) throw new Error("baselineMoved")

  // Appariement par CLÉ (pas par position). Une clé en doublon dans `live` violerait l'invariant no-overlap
  // (validateur de forme, inatteignable en prod) ; s'il survenait, la dernière entrée écrase — rattrapé
  // fail-closed par le check de cardinalité + une clé baseline alors orpheline → `baselineMoved`.
  const liveByKey = new Map(live.map((s) => [opts.keyOf(s), s]))
  for (const b of baseline) {
    const l = liveByKey.get(opts.keyOf(b))
    if (!l) throw new Error("baselineMoved") // créneau supprimé/déplacé (dérive de structure)
    if (opts.boundEq && !opts.boundEq(l, b)) throw new Error("baselineMoved") // borne déplacée (endHour/endTime)
    const lv = opts.valueOf(l)
    const bv = opts.valueOf(b)
    // Garde fail-closed : une valeur non finie (NaN/Infinity — JSON corrompu, colonne invalide) N'EST PAS
    // « inchangée » ; `NaN > EPS` vaut `false`, donc on ne peut pas se reposer sur la seule comparaison d'écart.
    if (!Number.isFinite(lv) || !Number.isFinite(bv)) throw new Error("baselineMoved")
    if (Math.abs(lv - bv) > BASELINE_VALUE_EPS) throw new Error("baselineMoved") // valeur ajustée
  }
}

/**
 * Vérifie que la base LIVE ISF/ICR est identique au snapshot `baselineSlots` (CAS d'ensemble). Wrapper
 * spécialisé de `assertBaselineUnchangedBy` (appariement `startHour`, borne `endHour`, `mealLabel` ignoré —
 * étiquette d'affichage non dosante). Lève un code métier stable (mappé **409** par la route d'acceptation).
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
  assertBaselineUnchangedBy(baseline, live, {
    keyOf: (s) => s.startHour,
    valueOf: (s) => s.value,
    boundEq: (l, b) => l.endHour === b.endHour,
  })
}

/**
 * Variante NON-THROWING d'`assertBaselineUnchanged`, pour l'AFFICHAGE (US-2663 S2 — écran de revue médecin).
 * L'écran de revue ne doit jamais planter sur une dérive/absence de base : il doit la SIGNALER (bandeau
 * d'avertissement) pour laisser le médecin décider en connaissance de cause, la garde bloquante réelle restant
 * `assertBaselineUnchanged` (appelée sous verrou par `acceptSetProposal`).
 *
 * @param baseline - snapshot `SlotSetProposal.baselineSlots` ; `null` = non certifiable (legacy ou JSON non
 * parsable) → traité comme une dérive (`false`), jamais comme « inchangé » (fail-closed sur l'affichage aussi).
 * @param live - disposition ISF/ICR actuellement active du patient.
 * @returns `true` si la base live est identique à la baseline (rien à signaler) ; `false` sinon (dérive ou
 * base non certifiable — l'appelant doit afficher un avertissement).
 */
export function isBaselineUnchanged(baseline: readonly IsfIcrSlot[] | null, live: readonly IsfIcrSlot[]): boolean {
  try {
    assertBaselineUnchanged(baseline, live)
    return true
  } catch {
    return false
  }
}
