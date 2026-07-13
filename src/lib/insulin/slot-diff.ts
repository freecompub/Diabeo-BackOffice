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
import type { IsfIcrSlot, PumpBasalSlot, FixedDoseSlot, StyloBasalSlot } from "@/lib/insulin/grouped-proposal"
import { BASELINE_VALUE_EPS } from "@/lib/insulin/slot-baseline-cas"

/** Une ligne du tableau de diff : un créneau PROPOSÉ (ou un créneau LIVE **supprimé** par la proposition). */
export type SlotDiffRow = {
  startHour: number
  endHour: number
  /** Valeur proposée ; `null` = créneau LIVE **supprimé** (présent en live, absent du proposé, `removed=true`). */
  proposedValue: number | null
  /** Valeur live appariée par la clé du levier ; `null` = **nouveau** créneau (absent de la config live). */
  liveValue: number | null
  mealLabel?: string
  /**
   * US-2663 (S3c) — libellé horaire d'affichage EXACT (`"05:00–08:00"`), présent pour la basale POMPE (temps
   * minute-précis). Absent pour ISF/ICR (l'UI se rabat sur `startHour`/`endHour` entiers). Le composant préfère
   * `timeLabel` quand fourni → jamais de perte de précision minute à l'affichage.
   */
  timeLabel?: string
  /**
   * US-2663 (S3d) — clé DOSE FIXE portée sur la ligne (`usage` + `moment`), pour le libellé traduit (« Bolus ·
   * Matin ») et l'appariement de la rationale par `(usage, moment)` côté composant. Absents pour ISF/ICR/pompe.
   * `startHour`/`endHour` reçoivent un ordre SYNTHÉTIQUE dérivé du moment (matin=0…nuit=3) pour le tri + la clé React.
   */
  usage?: string
  moment?: string
  /**
   * US-2663 (S3e) — clé BASALE STYLO portée sur la ligne (`daily`/`morning`/`evening`), pour le libellé traduit
   * (« Dose du soir ») et l'appariement de la rationale par `basalDoseKind` côté composant. Absent pour les autres
   * leviers. `startHour`/`endHour` reçoivent un ordre SYNTHÉTIQUE (daily/morning=0, evening=1) pour tri + clé React.
   */
  basalDoseKind?: string
  /**
   * US-2663 (S3d) — avertissement dose élevée NON bloquant, dérivé SERVEUR (bornes jamais côté client) : dose
   * proposée au-delà du seuil d'usage (`FIXED_BOLUS_WARN_U` 25 U bolus / `FIXED_BASAL_WARN_U` 80 U basal|both).
   * Renseigné par `page.tsx` sur les lignes DOSE FIXE ; le composant affiche un badge d'alerte. Absent ailleurs.
   */
  highDoseWarning?: boolean
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

/** Heure entière (0-23) d'un temps `"HH:MM"` — clé de tri/rationale d'une ligne pompe (l'affichage garde `"HH:MM"`). */
const hourOf = (hhmm: string): number => Number.parseInt(hhmm.slice(0, 2), 10)

/**
 * US-2663 (S3c) — DIFF pur POMPE (live → proposé), pendant de `diffSlots` pour le modèle `PumpBasalSlot`.
 * Appariement par `startTime` (`"HH:MM"`, minute-précis — pas par heure entière : deux créneaux peuvent
 * partager l'heure). `timeLabel` porte les bornes EXACTES (`"05:00–08:00"`) ; `startHour`/`endHour` (entiers,
 * dérivés) servent le tri et l'appariement de la rationale moteur (clé `startHour`). Valeur = débit (U/h).
 */
export function diffPumpSlots(live: readonly PumpBasalSlot[], proposed: readonly PumpBasalSlot[]): SlotDiffRow[] {
  const liveByStart = new Map(live.map((s) => [s.startTime, s]))
  const proposedStarts = new Set(proposed.map((s) => s.startTime))

  const proposedRows: SlotDiffRow[] = proposed.map((p) => {
    const match = liveByStart.get(p.startTime)
    const liveValue = match ? match.rate : null
    const changed =
      match === undefined ||
      match.endTime !== p.endTime ||
      !Number.isFinite(match.rate) ||
      Math.abs(match.rate - p.rate) > BASELINE_VALUE_EPS
    return {
      startHour: hourOf(p.startTime),
      endHour: hourOf(p.endTime),
      proposedValue: p.rate,
      liveValue,
      timeLabel: `${p.startTime}–${p.endTime}`,
      changed,
      removed: false,
    }
  })

  const removedRows: SlotDiffRow[] = live
    .filter((s) => !proposedStarts.has(s.startTime))
    .map((s) => ({
      startHour: hourOf(s.startTime),
      endHour: hourOf(s.endTime),
      proposedValue: null,
      liveValue: s.rate,
      timeLabel: `${s.startTime}–${s.endTime}`,
      changed: true,
      removed: true,
    }))

  return [...proposedRows, ...removedRows].sort((a, b) => a.startHour - b.startHour)
}

/** Dérive structurelle POMPE (cardinalité, ou un `startTime` live sans correspondance côté proposé). */
export function hasStructuralChangePump(live: readonly PumpBasalSlot[], proposed: readonly PumpBasalSlot[]): boolean {
  if (live.length !== proposed.length) return true
  const proposedStarts = new Set(proposed.map((s) => s.startTime))
  return live.some((s) => !proposedStarts.has(s.startTime))
}

/** Ordre synthétique du moment (matin=0 … nuit=3) → `startHour` de tri/clé pour la dose fixe (pas d'horaire réel). */
const MOMENT_ORDER: Record<string, number> = { morning: 0, noon: 1, evening: 2, night: 3 }
const fixedKey = (s: { usage: string; moment: string }) => `${s.usage}:${s.moment}`

/**
 * US-2663 (S3d) — DIFF pur DOSE FIXE (live → proposé), pendant de `diffSlots` pour le modèle `FixedDoseSlot`.
 * Appariement par clé **`(usage, moment)`** (une même heure/moment peut porter bolus ET basal). `usage`/`moment`
 * portés sur la ligne (libellé traduit + appariement rationale côté composant) ; `startHour` = ordre synthétique
 * du moment (tri/clé React, pas un horaire réel). Valeur = dose U. Pas de borne (dose ponctuelle).
 */
export function diffFixedDoseSlots(live: readonly FixedDoseSlot[], proposed: readonly FixedDoseSlot[]): SlotDiffRow[] {
  const liveByKey = new Map(live.map((s) => [fixedKey(s), s]))
  const proposedKeys = new Set(proposed.map(fixedKey))
  const ord = (s: { moment: string }) => MOMENT_ORDER[s.moment] ?? 9

  const proposedRows: SlotDiffRow[] = proposed.map((p) => {
    const match = liveByKey.get(fixedKey(p))
    const changed = match === undefined || !Number.isFinite(match.value) || Math.abs(match.value - p.value) > BASELINE_VALUE_EPS
    return {
      startHour: ord(p),
      endHour: ord(p),
      proposedValue: p.value,
      liveValue: match ? match.value : null,
      usage: p.usage,
      moment: p.moment,
      changed,
      removed: false,
    }
  })

  const removedRows: SlotDiffRow[] = live
    .filter((s) => !proposedKeys.has(fixedKey(s)))
    .map((s) => ({
      startHour: ord(s),
      endHour: ord(s),
      proposedValue: null,
      liveValue: s.value,
      usage: s.usage,
      moment: s.moment,
      changed: true,
      removed: true,
    }))

  return [...proposedRows, ...removedRows].sort((a, b) => a.startHour - b.startHour)
}

/** Dérive structurelle DOSE FIXE (cardinalité, ou une clé `(usage, moment)` live sans correspondance côté proposé). */
export function hasStructuralChangeFixedDose(live: readonly FixedDoseSlot[], proposed: readonly FixedDoseSlot[]): boolean {
  if (live.length !== proposed.length) return true
  const proposedKeys = new Set(proposed.map(fixedKey))
  return live.some((s) => !proposedKeys.has(fixedKey(s)))
}

/** Ordre synthétique de la dose stylo (daily/morning = 0, evening = 1) → `startHour` de tri/clé (pas d'horaire réel). */
const STYLO_KIND_ORDER: Record<string, number> = { daily: 0, morning: 0, evening: 1 }

/**
 * US-2663 (S3e) — DIFF pur BASALE STYLO (live → proposé), pendant de `diffSlots` pour le modèle `StyloBasalSlot`.
 * Appariement par clé **`kind`** (`daily`/`morning`/`evening`, U TOTALES — jamais U/h). `basalDoseKind` porté sur
 * la ligne (libellé traduit « Dose du soir » + appariement rationale par `basalDoseKind` côté composant) ;
 * `startHour` = ordre synthétique (pas un horaire réel). Valeur = dose U totales. Pas de borne (dose ponctuelle).
 */
export function diffStyloBasalSlots(live: readonly StyloBasalSlot[], proposed: readonly StyloBasalSlot[]): SlotDiffRow[] {
  const liveByKind = new Map(live.map((s) => [s.kind, s]))
  const proposedKinds = new Set(proposed.map((s) => s.kind))
  const ord = (kind: string) => STYLO_KIND_ORDER[kind] ?? 9

  const proposedRows: SlotDiffRow[] = proposed.map((p) => {
    const match = liveByKind.get(p.kind)
    const changed = match === undefined || !Number.isFinite(match.value) || Math.abs(match.value - p.value) > BASELINE_VALUE_EPS
    return {
      startHour: ord(p.kind),
      endHour: ord(p.kind),
      proposedValue: p.value,
      liveValue: match ? match.value : null,
      basalDoseKind: p.kind,
      changed,
      removed: false,
    }
  })

  const removedRows: SlotDiffRow[] = live
    .filter((s) => !proposedKinds.has(s.kind))
    .map((s) => ({
      startHour: ord(s.kind),
      endHour: ord(s.kind),
      proposedValue: null,
      liveValue: s.value,
      basalDoseKind: s.kind,
      changed: true,
      removed: true,
    }))

  return [...proposedRows, ...removedRows].sort((a, b) => a.startHour - b.startHour)
}

/** Dérive structurelle BASALE STYLO (cardinalité, ou un `kind` live sans correspondance côté proposé). */
export function hasStructuralChangeStylo(live: readonly StyloBasalSlot[], proposed: readonly StyloBasalSlot[]): boolean {
  if (live.length !== proposed.length) return true
  const proposedKinds = new Set(proposed.map((s) => s.kind))
  return live.some((s) => !proposedKinds.has(s.kind))
}
