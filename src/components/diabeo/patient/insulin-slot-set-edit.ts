/**
 * US-2656 — Logique PURE de l'édition de GROUPE de créneaux (fenêtre « tous les créneaux »).
 *
 * Testable sans i18n ni fetch/DOM. Trois responsabilités :
 *  1. **Cohérence** (`describeCoverage`) — réutilise `analyzeSlotCoverage` (source de vérité
 *     trou/chevauchement, partagée avec le serveur US-2655) et calcule en plus les **fenêtres**
 *     humaines (« trou 10 h–12 h ») + les créneaux **en conflit** à surligner.
 *  2. **Validation** (`validateRows`, `canSubmit`) — durée nulle, bornes de valeur, ≥ 1 créneau,
 *     au moins une modification.
 *  3. **Requête + issue** (`buildReplaceRequest`, `mapSlotSetOutcome`) — corps du PUT (jeu complet)
 *     et mapping (statut, code) → clé de message. Le `patientId` est ajouté par le transport injecté.
 *
 * Convention d'encodage alignée sur le serveur : `endHour ∈ [0,23]`, un profil complet enjambe minuit
 * via un créneau `startHour > endHour` (ex. `[22,6)`). `hourToTime`/dénormalisation restent serveur.
 */
import { analyzeSlotCoverage } from "@/lib/insulin/slot-coverage"
import { ENDPOINT, VALUE_FIELD } from "@/components/diabeo/patient/insulin-direct-edit"

/** Paramètre éditable en groupe (slice 1 : ISF / ICR ; basale ultérieure). */
export type SlotSetParameter = "insulinSensitivityFactor" | "insulinToCarbRatio"

/** Ligne de la fenêtre d'édition (état front). `key` = identité React stable, jamais envoyée. */
export type SlotRow = {
  key: string
  startHour: number
  endHour: number
  /** Valeur brute saisie (texte) — parsée pour validation/envoi. */
  value: string
  mealLabel?: string
}

/** Plage horaire (heure de fin **exclusive**, 24 = minuit). */
export type HourRange = { startHour: number; endHour: number }

export type CoverageReport = {
  hasGap: boolean
  hasOverlap: boolean
  /** Fenêtres non couvertes (pour nommer « trou 10 h–12 h »). */
  gaps: HourRange[]
  /** Fenêtres couvertes ≥ 2 fois (chevauchement). */
  overlaps: HourRange[]
  /** Clés des lignes à surligner (bordant un trou ou impliquées dans un chevauchement). */
  conflictKeys: Set<string>
  /** Nombre de créneaux couvrant chaque heure `[0..23]` (0 = trou, ≥ 2 = chevauchement). Pour la frise 24 h. */
  cover: number[]
}

/** Parse une valeur saisie (« 0,45 » → 0.45). `null` si non finie/vide. */
export function parseSlotValue(raw: string): number | null {
  const v = Number(raw.replace(",", "."))
  return Number.isFinite(v) && raw.trim() !== "" ? v : null
}

/** Heures couvertes par un créneau `[s,e)` (gestion enjambement minuit, durée nulle ignorée). */
function coveredHours(startHour: number, endHour: number): number[] {
  if (startHour === endHour) return []
  const hours: number[] = []
  if (startHour < endHour) {
    for (let h = startHour; h < endHour; h++) hours.push(h)
  } else {
    for (let h = startHour; h < 24; h++) hours.push(h)
    for (let h = 0; h < endHour; h++) hours.push(h)
  }
  return hours
}

/** Regroupe des heures triées en plages `[start, endExclusive)`. */
function groupHours(hours: number[]): HourRange[] {
  if (hours.length === 0) return []
  const sorted = [...new Set(hours)].sort((a, b) => a - b)
  const ranges: HourRange[] = []
  let start = sorted[0]!
  let prev = sorted[0]!
  for (let i = 1; i < sorted.length; i++) {
    const h = sorted[i]!
    if (h === prev + 1) {
      prev = h
    } else {
      ranges.push({ startHour: start, endHour: prev + 1 })
      start = h
      prev = h
    }
  }
  ranges.push({ startHour: start, endHour: prev + 1 })
  return ranges
}

/**
 * Analyse la couverture 24 h du jeu de créneaux : booléens (via `analyzeSlotCoverage`, autorité
 * partagée serveur) + fenêtres trou/chevauchement + lignes à surligner.
 */
export function describeCoverage(rows: Array<Pick<SlotRow, "key" | "startHour" | "endHour">>): CoverageReport {
  const { hasGap, hasOverlap } = analyzeSlotCoverage(
    rows.map((r) => ({ start: r.startHour * 60, end: r.endHour * 60 })),
  )

  // Comptage horaire (0–23) pour dériver fenêtres + conflits (cohérent avec analyzeSlotCoverage).
  const cover = new Array<number>(24).fill(0)
  for (const r of rows) for (const h of coveredHours(r.startHour, r.endHour)) cover[h]! += 1

  const gapHours: number[] = []
  const overlapHours: number[] = []
  for (let h = 0; h < 24; h++) {
    if (cover[h] === 0) gapHours.push(h)
    else if (cover[h]! >= 2) overlapHours.push(h)
  }
  const gaps = groupHours(gapHours)
  const overlaps = groupHours(overlapHours)

  const conflictKeys = new Set<string>()
  const overlapSet = new Set(overlapHours)
  const gapSet = new Set(gapHours)
  for (const r of rows) {
    // Chevauchement : la ligne couvre une heure en conflit.
    if (coveredHours(r.startHour, r.endHour).some((h) => overlapSet.has(h))) {
      conflictKeys.add(r.key)
      continue
    }
    // Trou adjacent : l'heure juste après le créneau (`endHour`, exclusive) ou juste avant
    // (`startHour - 1`) est non couverte → la ligne borde le trou.
    if (gapSet.has(r.endHour % 24) || gapSet.has((r.startHour + 23) % 24)) conflictKeys.add(r.key)
  }

  return { hasGap, hasOverlap, gaps, overlaps, conflictKeys, cover }
}

export type RowValidation = {
  /** Clés des lignes dont la valeur est hors bornes / non parseable. */
  invalidValueKeys: Set<string>
  /** Clés des lignes de durée nulle (startHour === endHour). */
  zeroDurationKeys: Set<string>
  isEmpty: boolean
}

/** Valide les lignes contre les bornes cliniques (`min`/`max`) + durée nulle + jeu vide. */
export function validateRows(rows: SlotRow[], bounds: { min: number; max: number }): RowValidation {
  const invalidValueKeys = new Set<string>()
  const zeroDurationKeys = new Set<string>()
  for (const r of rows) {
    if (r.startHour === r.endHour) zeroDurationKeys.add(r.key)
    const v = parseSlotValue(r.value)
    if (v === null || v < bounds.min || v > bounds.max) invalidValueKeys.add(r.key)
  }
  return { invalidValueKeys, zeroDurationKeys, isEmpty: rows.length === 0 }
}

/**
 * « Valider » actif ? Exige : cohérence (aucun trou/chevauchement) ET aucune valeur invalide/durée
 * nulle ET ≥ 1 créneau ET au moins une modification vs l'état initial.
 */
export function canSubmit(
  rows: SlotRow[],
  bounds: { min: number; max: number },
  isDirty: boolean,
): boolean {
  if (rows.length === 0 || !isDirty) return false
  const cov = describeCoverage(rows)
  if (cov.hasGap || cov.hasOverlap) return false
  const val = validateRows(rows, bounds)
  return val.invalidValueKeys.size === 0 && val.zeroDurationKeys.size === 0
}

/**
 * Corps du PUT « remplace le jeu complet » : `{ slots: [{ startHour, endHour, <champ valeur>, mealLabel? }] }`.
 * `patientId` ajouté par le transport injecté. Suppose les lignes déjà validées (`canSubmit`).
 */
export function buildReplaceRequest(
  param: SlotSetParameter,
  rows: SlotRow[],
): { endpoint: string; body: { slots: Array<Record<string, unknown>> } } {
  const field = VALUE_FIELD[param]
  const slots = rows.map((r) => {
    const slot: Record<string, unknown> = {
      startHour: r.startHour,
      endHour: r.endHour,
      [field]: parseSlotValue(r.value),
    }
    if (param === "insulinToCarbRatio" && r.mealLabel) slot.mealLabel = r.mealLabel
    return slot
  })
  return { endpoint: ENDPOINT[param], body: { slots } }
}

export type SlotSetOutcome = { kind: "success" } | { kind: "error"; messageKey: string }

const ERROR_KEY: Record<string, string> = {
  slotOverlap: "slotSetErrorOverlap",
  slotGap: "slotSetErrorGap",
  zeroDurationSlot: "slotSetErrorZeroDuration",
  valueOutOfBounds: "slotSetErrorBounds",
  emptySlotSet: "slotSetErrorEmpty",
  validationFailed: "slotSetErrorValidation",
  settingsNotFound: "slotSetErrorNotFound",
  patientNotFound: "slotSetErrorNotFound",
  gdprConsentRequired: "slotSetErrorConsent",
}

/** (statut HTTP, code d'erreur) → issue. `200` = appliqué. Sert au rejet serveur (autorité). */
export function mapSlotSetOutcome(status: number, code: string | undefined): SlotSetOutcome {
  if (status === 200) return { kind: "success" }
  return { kind: "error", messageKey: ERROR_KEY[code ?? ""] ?? "slotSetErrorGeneric" }
}
