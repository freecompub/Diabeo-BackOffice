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
 *
 * US-2657 (grouped-only, ADR #23) — la voie basale (débit pompe) rejoint ce module : le modèle de
 * créneau diffère (temps `"HH:MM"` minute-précis, pas une heure entière `[0,23]`) et le débit doit
 * être **délivrable** (multiple de l'incrément pompe), donc un jeu de fonctions PARALLÈLE dédié
 * (`BasalSlotRow`, `describeBasalCoverage`, `validateBasalRows`, `canSubmitBasal`,
 * `buildReplaceBasalRequest`) plutôt qu'une généralisation forcée des types heure-entière ISF/ICR
 * ci-dessus (qui resteraient inchangés, verrouillés par `tests/unit/insulin-slot-set-edit.test.ts`).
 * Les DEUX voies partagent `parseSlotValue`, `mapSlotSetOutcome` et l'analyse d'autorité
 * `analyzeSlotCoverage` (même définition trou/chevauchement que le serveur, minute-précise).
 */
import { analyzeSlotCoverage } from "@/lib/insulin/slot-coverage"
import { isDeliverableBasalRate, isDeliverableFixedDose } from "@/lib/clinical-bounds"
import { ENDPOINT, VALUE_FIELD } from "@/components/diabeo/patient/insulin-parameter-endpoints"

/** Paramètre éditable en groupe (ISF / ICR — heure entière). Le basal (temps `HH:MM`) a son propre
 * jeu de types (`BasalSlotRow` etc.) ci-dessous : modèle de créneau non superposable. */
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
 * Fusionne une plage finissant à minuit (`endHour === 24`) avec une plage commençant à `0` en une
 * seule fenêtre **enjambant minuit** (ex. `[23,24)` + `[0,2)` → `[23,2)`), pour un nommage cohérent
 * (« 23h–02h ») plutôt que deux fenêtres scindées à 00h.
 */
function mergeWrap(ranges: HourRange[]): HourRange[] {
  if (ranges.length < 2) return ranges
  const first = ranges[0]!
  const last = ranges[ranges.length - 1]!
  if (first.startHour === 0 && last.endHour === 24) {
    return [{ startHour: last.startHour, endHour: first.endHour }, ...ranges.slice(1, -1)]
  }
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
  const gaps = mergeWrap(groupHours(gapHours))
  const overlaps = mergeWrap(groupHours(overlapHours))

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
  invalidSlotSet: "slotSetErrorValidation", // forme JSON invalide (défense ; réutilise la clé validation)
  settingsNotFound: "slotSetErrorNotFound",
  patientNotFound: "slotSetErrorNotFound",
  gdprConsentRequired: "slotSetErrorConsent",
  // US-2657 (grouped-only) — codes propres à la voie basale (`replacePumpSlotSet`) : débit non
  // délivrable (multiple de l'incrément pompe) et absence de configuration basale ; `slotsBusy`
  // (verrou non bloquant) est levé par les TROIS voies (ISF/ICR/basal), auparavant non mappé
  // (retombait sur le message générique).
  rateNotDeliverable: "slotSetErrorRateNotDeliverable",
  basalConfigNotFound: "slotSetErrorNotFound",
  basalConfigNotPump: "slotSetErrorNotFound", // patient MDI (non pompe) — édition basale pompe non applicable
  // US-2663 (S3e) — voie BASALE STYLO : patient devenu pompe (config LIVE non stylo), bascule single↔split, ou
  // CAS atomique non satisfait (dose dérivée/effacée sous la proposition) — conflit récupérable, régénérer.
  basalConfigNotStylo: "slotSetErrorNotFound",
  styloBasalConfigMismatch: "slotSetErrorNotFound",
  styloBasalNotFound: "slotSetErrorNotFound",
  slotsBusy: "slotSetErrorBusy",
  // US-2663 (S4) — voie manuelle GROUPÉE (proposition). Codes de la garde clinique PATIENT
  // (`evaluatePatientGroupedGate`) + du RBAC/anti-abus des routes de proposition groupée.
  maturityTooLowForDecrease: "slotSetErrorMaturityTooLow",
  dkaAcknowledgmentRequired: "slotSetErrorDkaRequired",
  patientDeltaTooLarge: "slotSetErrorDeltaTooLarge",
  noChangeProposed: "slotSetErrorNoChange",
  deliveryModeMismatch: "slotSetErrorModeMismatch",
  // Restructuration interdite côté PATIENT (re-partition de créneaux / ajout-retrait / bascule de modalité) :
  // un patient édite des VALEURS, pas la structure. Filet UX (l'UI patient est déjà « valeurs seules »).
  structuralChangeNotAllowed: "slotSetErrorStructural",
  forbidden: "slotSetErrorForbidden",
  rateLimitExceeded: "slotSetErrorRateLimited",
}

/**
 * (statut HTTP, code d'erreur) → issue. `200` = appliqué (voie DOCTOR directe) ; `201` = proposition
 * d'ensemble créée (voie manuelle groupée patient/soignant, US-2663 S4). Sert au rejet serveur (autorité).
 */
export function mapSlotSetOutcome(status: number, code: string | undefined): SlotSetOutcome {
  if (status === 200 || status === 201) return { kind: "success" }
  return { kind: "error", messageKey: ERROR_KEY[code ?? ""] ?? "slotSetErrorGeneric" }
}

// ─────────────────────────────────────────────────────────────────────────────
// US-2663 (S4) — voie manuelle GROUPÉE (PROPOSITION) : ISF/ICR + basale pompe + basale stylo.
//
// Contrat backend (S4) :
//   • PRO (nurse/doctor)  → `POST /api/slot-set-proposals`  body `{ parameterType, proposedSlots }`
//   • PATIENT (own-id)    → `PUT  /api/patient/insulin-slot-set` body `{ parameterType, slots, sickDayAcknowledged? }`
// Les DEUX renvoient `201 { outcome: "proposal", proposalId }`. La provenance est dérivée SERVEUR
// (jamais du body). Le champ de valeur des créneaux suit la forme `@/lib/insulin/grouped-proposal`
// (ISF/ICR `value`, pompe `rate`, stylo `value`) — DIFFÉRENT des champs de la voie directe
// (`sensitivityFactorGl`/`gramsPerUnit`/`rate`, cf. `VALUE_FIELD`).
// ─────────────────────────────────────────────────────────────────────────────

/** Audience de la soumission groupée : soignant (route pro) vs patient own-id (route patient). */
export type ProposeAudience = "pro" | "patient"

/** Endpoint pro de création groupée (`POST`, provenance dérivée session). */
export const PROPOSE_PRO_ENDPOINT = "/api/slot-set-proposals"
/** Endpoint patient own-id de soumission groupée (`PUT`, pas de `patientId`). */
export const PROPOSE_PATIENT_ENDPOINT = "/api/patient/insulin-slot-set"

/** Levier proposable en groupe (ISF/ICR heure-entière + basale pompe/stylo). */
export type ProposeParameter = SlotSetParameter | "basalRate"

export type ProposeRequest = {
  endpoint: string
  method: "POST" | "PUT"
  body: Record<string, unknown>
}

/**
 * Enveloppe commune (pro vs patient) d'une proposition groupée. `patientId` est ajouté par le
 * transport injecté (adaptateur page/drawer) — ignoré côté route patient (own-id strict).
 * `sickDayAcknowledged` n'est envoyé qu'en audience patient (les soignants ne sont pas gatés).
 */
function proposeEnvelope(
  parameterType: ProposeParameter,
  slots: Array<Record<string, unknown>>,
  audience: ProposeAudience,
  sickDayAcknowledged?: boolean,
): ProposeRequest {
  if (audience === "pro") {
    return { endpoint: PROPOSE_PRO_ENDPOINT, method: "POST", body: { parameterType, proposedSlots: slots } }
  }
  return {
    endpoint: PROPOSE_PATIENT_ENDPOINT,
    method: "PUT",
    body: { parameterType, slots, ...(sickDayAcknowledged ? { sickDayAcknowledged: true } : {}) },
  }
}

/**
 * Corps de PROPOSITION groupée ISF/ICR : créneaux `{ startHour, endHour, value, mealLabel? }`
 * (forme `IsfIcrSlot`). Suppose les lignes déjà validées (`canSubmit`).
 */
export function buildProposeRequest(
  param: SlotSetParameter,
  rows: SlotRow[],
  audience: ProposeAudience,
): ProposeRequest {
  const slots = rows.map((r) => {
    const slot: Record<string, unknown> = { startHour: r.startHour, endHour: r.endHour, value: parseSlotValue(r.value) }
    if (param === "insulinToCarbRatio" && r.mealLabel) slot.mealLabel = r.mealLabel
    return slot
  })
  return proposeEnvelope(param, slots, audience)
}

/**
 * Corps de PROPOSITION groupée BASALE POMPE : créneaux `{ startTime, endTime, rate }` (forme
 * `PumpBasalSlot`). Une baisse basale POMPE n'exige PAS d'accusé DKA (gate stylo uniquement).
 * Suppose les lignes déjà validées (`canSubmitBasal`).
 */
export function buildProposeBasalRequest(
  rows: BasalSlotRow[],
  audience: ProposeAudience,
): ProposeRequest {
  const slots = rows.map((r) => ({ startTime: r.startTime, endTime: r.endTime, rate: parseSlotValue(r.value) }))
  return proposeEnvelope("basalRate", slots, audience)
}

// ── Basale STYLO (MDI) : doses en U TOTALES, discriminées par `kind` (daily / morning / evening) ──

/** Dose de basale stylo ciblée : `daily` (single) ou `morning`+`evening` (split). */
export type StyloKind = "daily" | "morning" | "evening"

/**
 * Ligne d'édition d'une dose basale STYLO (état front). `key` = identité React stable (jamais envoyée) ;
 * `initialValue` = dose ACTIVE (U totales) servant à détecter une BAISSE (déclencheur de l'accusé DKA).
 */
export type StyloDoseRow = {
  key: string
  kind: StyloKind
  /** Dose brute saisie (texte) — parsée pour validation/envoi. */
  value: string
  /** Dose active (U) au chargement — base de comparaison de direction (baisse ⇒ accusé DKA). */
  initialValue: number
}

export type StyloRowValidation = {
  /** Clés des lignes dont la dose est hors bornes / non parseable. */
  invalidValueKeys: Set<string>
  isEmpty: boolean
}

/** Valide les doses stylo contre les bornes cliniques (`min`/`max`, U totales) + jeu vide. */
export function validateStyloRows(rows: StyloDoseRow[], bounds: { min: number; max: number }): StyloRowValidation {
  const invalidValueKeys = new Set<string>()
  for (const r of rows) {
    const v = parseSlotValue(r.value)
    // Pré-validation client (le serveur reste l'autorité) : bornes U totales + délivrabilité ½ U — évite un
    // aller-retour `rateNotDeliverable` sur une dose type 20,3 U (miroir de `assertValidStyloBasalSet`).
    if (v === null || v < bounds.min || v > bounds.max || !isDeliverableFixedDose(v)) invalidValueKeys.add(r.key)
  }
  return { invalidValueKeys, isEmpty: rows.length === 0 }
}

/**
 * Le jeu contient-il AU MOINS UNE baisse de dose stylo (valeur saisie < dose active) ? Miroir front du
 * déclencheur serveur de l'accusé DKA (`evaluatePatientGroupedGate`) : en audience patient, une baisse
 * stylo exige l'accusé jour-de-maladie/acidocétose (DKA). Les lignes non parseables ne comptent pas.
 */
export function hasStyloDecrease(rows: StyloDoseRow[]): boolean {
  return rows.some((r) => {
    const v = parseSlotValue(r.value)
    return v !== null && v < r.initialValue
  })
}

/**
 * « Valider » actif (stylo) ? Exige : aucune dose invalide ET ≥ 1 dose ET au moins une modification.
 * Le gating de l'accusé DKA (baisse stylo en audience patient) est appliqué EN PLUS par le composant.
 */
export function canSubmitStylo(rows: StyloDoseRow[], bounds: { min: number; max: number }, isDirty: boolean): boolean {
  if (rows.length === 0 || !isDirty) return false
  return validateStyloRows(rows, bounds).invalidValueKeys.size === 0
}

/**
 * Corps de PROPOSITION groupée BASALE STYLO : créneaux `{ kind, value }` (forme `StyloBasalSlot`,
 * U totales). `sickDayAcknowledged` transmis (audience patient) ssi le jeu porte ≥ 1 baisse.
 * Suppose les lignes déjà validées (`canSubmitStylo`).
 */
export function buildProposeStyloRequest(
  rows: StyloDoseRow[],
  audience: ProposeAudience,
  sickDayAcknowledged?: boolean,
): ProposeRequest {
  const slots = rows.map((r) => ({ kind: r.kind, value: parseSlotValue(r.value) }))
  return proposeEnvelope("basalRate", slots, audience, sickDayAcknowledged)
}

// ─────────────────────────────────────────────────────────────────────────────
// US-2657 (grouped-only, ADR #23) — voie BASALE (créneaux pompe, temps `"HH:MM"`)
// ─────────────────────────────────────────────────────────────────────────────

/** Ligne de la fenêtre d'édition basale (état front). `key` = identité React stable, jamais envoyée. */
export type BasalSlotRow = {
  key: string
  /** `"HH:MM"` (24 h) — alimenté par un `<input type="time">`, déjà normalisé par le navigateur. */
  startTime: string
  endTime: string
  /** Débit brut saisi (texte) — parsé pour validation/envoi (`parseSlotValue`). */
  value: string
}

/** Plage horaire `"HH:MM"` (fin exclusive) — pendant basal de {@link HourRange}. */
export type TimeRange = { startTime: string; endTime: string }

export type BasalCoverageReport = {
  hasGap: boolean
  hasOverlap: boolean
  /** Fenêtres non couvertes (pour nommer « trou 10:15–10:45 »). */
  gaps: TimeRange[]
  /** Fenêtres couvertes ≥ 2 fois (chevauchement). */
  overlaps: TimeRange[]
  /** Clés des lignes à surligner (bordant un trou ou impliquées dans un chevauchement). */
  conflictKeys: Set<string>
  /**
   * Occupation décorative de la frise 24 h, sous-échantillonnée à la demi-heure (48 cases) — la
   * couverture réelle (`hasGap`/`hasOverlap`) reste calculée à la **minute** (voir ci-dessous) ;
   * cette frise n'est qu'un indice visuel `aria-hidden`, la bannière de texte porte l'information.
   */
  cover: number[]
}

const MINUTES_PER_DAY = 1440
const BASAL_BAR_BUCKETS = 48
const MINUTES_PER_BUCKET = MINUTES_PER_DAY / BASAL_BAR_BUCKETS

/** `"HH:MM"` (24 h, zéro-paddé) → minutes `[0,1439]`. `null` si format illisible (défense en profondeur ;
 * `<input type="time">` normalise déjà, mais un champ vidé par l'utilisateur renvoie `""`). */
export function parseHHMM(raw: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(raw)
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

/** Minutes `[0,1439]` → `"HH:MM"` (24 h, zéro-paddé). */
function minutesToHHMM(totalMin: number): string {
  const m = ((totalMin % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
}

/** Minutes couvertes par un créneau `[s,e)` (gestion enjambement minuit, durée nulle ignorée). Pendant
 * minute-précis de `coveredHours` (ci-dessus). */
function coveredMinutes(startMin: number, endMin: number): number[] {
  if (startMin === endMin) return []
  const minutes: number[] = []
  if (startMin < endMin) {
    for (let m = startMin; m < endMin; m++) minutes.push(m)
  } else {
    for (let m = startMin; m < MINUTES_PER_DAY; m++) minutes.push(m)
    for (let m = 0; m < endMin; m++) minutes.push(m)
  }
  return minutes
}

/** Regroupe des minutes triées en plages `[start, endExclusive)`. Pendant minute-précis de `groupHours`. */
function groupMinutes(minutes: number[]): { start: number; end: number }[] {
  if (minutes.length === 0) return []
  const sorted = [...new Set(minutes)].sort((a, b) => a - b)
  const ranges: { start: number; end: number }[] = []
  let start = sorted[0]!
  let prev = sorted[0]!
  for (let i = 1; i < sorted.length; i++) {
    const m = sorted[i]!
    if (m === prev + 1) {
      prev = m
    } else {
      ranges.push({ start, end: prev + 1 })
      start = m
      prev = m
    }
  }
  ranges.push({ start, end: prev + 1 })
  return ranges
}

/** Fusionne une plage finissant à minuit avec une plage commençant à `0` (enjambement). Pendant
 * minute-précis de `mergeWrap`. */
function mergeWrapMinutes(ranges: { start: number; end: number }[]): { start: number; end: number }[] {
  if (ranges.length < 2) return ranges
  const first = ranges[0]!
  const last = ranges[ranges.length - 1]!
  if (first.start === 0 && last.end === MINUTES_PER_DAY) {
    return [{ start: last.start, end: first.end }, ...ranges.slice(1, -1)]
  }
  return ranges
}

/**
 * Analyse la couverture 24 h d'un jeu de créneaux BASAUX, à la **minute** (aligné sur le serveur —
 * `assertValidPumpSlotSet`/`analyzeSlotCoverage`, PAS d'arrondi à l'heure comme ISF/ICR : un créneau
 * pompe peut commencer/finir à n'importe quelle minute). Les lignes de temps illisible (`parseHHMM` →
 * `null`) sont exclues du calcul de couverture ici — elles sont signalées séparément par
 * `validateBasalRows` (`invalidTimeKeys`), pas comme un trou.
 */
export function describeBasalCoverage(rows: BasalSlotRow[]): BasalCoverageReport {
  const parsed = rows
    .map((r) => ({ key: r.key, start: parseHHMM(r.startTime), end: parseHHMM(r.endTime) }))
    .filter((r): r is { key: string; start: number; end: number } => r.start !== null && r.end !== null)

  const { hasGap, hasOverlap } = analyzeSlotCoverage(parsed.map((r) => ({ start: r.start, end: r.end })))

  const cover1440 = new Array<number>(MINUTES_PER_DAY).fill(0)
  for (const r of parsed) for (const m of coveredMinutes(r.start, r.end)) cover1440[m]! += 1

  const gapMinutes: number[] = []
  const overlapMinutes: number[] = []
  for (let m = 0; m < MINUTES_PER_DAY; m++) {
    if (cover1440[m] === 0) gapMinutes.push(m)
    else if (cover1440[m]! >= 2) overlapMinutes.push(m)
  }
  const toTimeRanges = (rs: { start: number; end: number }[]): TimeRange[] =>
    rs.map((r) => ({ startTime: minutesToHHMM(r.start), endTime: minutesToHHMM(r.end) }))
  const gaps = toTimeRanges(mergeWrapMinutes(groupMinutes(gapMinutes)))
  const overlaps = toTimeRanges(mergeWrapMinutes(groupMinutes(overlapMinutes)))

  const conflictKeys = new Set<string>()
  const overlapSet = new Set(overlapMinutes)
  const gapSet = new Set(gapMinutes)
  for (const r of parsed) {
    if (coveredMinutes(r.start, r.end).some((m) => overlapSet.has(m))) {
      conflictKeys.add(r.key)
      continue
    }
    if (gapSet.has(r.end % MINUTES_PER_DAY) || gapSet.has((r.start + MINUTES_PER_DAY - 1) % MINUTES_PER_DAY)) {
      conflictKeys.add(r.key)
    }
  }

  const cover = Array.from({ length: BASAL_BAR_BUCKETS }, (_, i) => cover1440[i * MINUTES_PER_BUCKET]!)

  return { hasGap, hasOverlap, gaps, overlaps, conflictKeys, cover }
}

export type BasalRowValidation = {
  /** Clés des lignes dont le débit est hors bornes, non parseable, ou non délivrable (pas un multiple
   * de l'incrément pompe `PUMP_BASAL_INCREMENT`). */
  invalidValueKeys: Set<string>
  /** Clés des lignes dont `startTime`/`endTime` n'est pas un `"HH:MM"` lisible. */
  invalidTimeKeys: Set<string>
  /** Clés des lignes de durée nulle (`startTime === endTime`). */
  zeroDurationKeys: Set<string>
  isEmpty: boolean
}

/**
 * Valide les lignes basales contre les bornes cliniques (`min`/`max`) **et** la délivrabilité pompe
 * (`isDeliverableBasalRate`, source unique `clinical-bounds.ts`) + temps lisible + durée nulle + jeu
 * vide. Miroir front de `assertValidPumpSlotSet` (serveur, autorité) — confort UI uniquement.
 */
export function validateBasalRows(
  rows: BasalSlotRow[],
  bounds: { min: number; max: number },
): BasalRowValidation {
  const invalidValueKeys = new Set<string>()
  const invalidTimeKeys = new Set<string>()
  const zeroDurationKeys = new Set<string>()
  for (const r of rows) {
    const s = parseHHMM(r.startTime)
    const e = parseHHMM(r.endTime)
    if (s === null || e === null) {
      invalidTimeKeys.add(r.key)
      continue
    }
    if (s === e) zeroDurationKeys.add(r.key)
    const v = parseSlotValue(r.value)
    if (v === null || v < bounds.min || v > bounds.max || !isDeliverableBasalRate(v)) {
      invalidValueKeys.add(r.key)
    }
  }
  return { invalidValueKeys, invalidTimeKeys, zeroDurationKeys, isEmpty: rows.length === 0 }
}

/**
 * « Valider » actif ? Exige : cohérence minute-précise (aucun trou/chevauchement) ET aucun temps/débit
 * invalide ET ≥ 1 créneau ET au moins une modification vs l'état initial. Pendant basal de `canSubmit`.
 */
export function canSubmitBasal(
  rows: BasalSlotRow[],
  bounds: { min: number; max: number },
  isDirty: boolean,
): boolean {
  if (rows.length === 0 || !isDirty) return false
  const cov = describeBasalCoverage(rows)
  if (cov.hasGap || cov.hasOverlap) return false
  const val = validateBasalRows(rows, bounds)
  return val.invalidValueKeys.size === 0 && val.invalidTimeKeys.size === 0 && val.zeroDurationKeys.size === 0
}

/**
 * Corps du PUT basal groupé : `{ slots: [{ startTime, endTime, rate }] }` (contrat
 * `PUT /api/insulin-therapy/basal-config/pump-slots`, US-2657). `patientId` ajouté par le transport
 * injecté. Suppose les lignes déjà validées (`canSubmitBasal`).
 */
export function buildReplaceBasalRequest(
  rows: BasalSlotRow[],
): { endpoint: string; body: { slots: Array<Record<string, unknown>> } } {
  const slots = rows.map((r) => ({
    startTime: r.startTime,
    endTime: r.endTime,
    [VALUE_FIELD.basalRate]: parseSlotValue(r.value),
  }))
  return { endpoint: ENDPOINT.basalRate, body: { slots } }
}
