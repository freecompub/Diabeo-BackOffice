/**
 * Mapping pur (testable) des réglages d'insulinothérapie + traitements associés
 * vers la vue dossier patient (Phase 3).
 *
 * Aucune dépendance RSC/Prisma. Affiche la **config réelle par créneau** (pas
 * de moyenne lossy) : ISF (g/L/U), ICR (g/U), débit basal (U/h). Conversions
 * Decimal→number ; bornes horaires formatées. Aucun calcul clinique.
 */

export type InsulinDelivery = "pump" | "manual"

type DecimalLike = number | string | { toString(): string }
const num = (x: DecimalLike): number => Number(x)

/** "Time" Prisma (Date @db.Time, sans TZ) → "HH:MM" (heure stockée). */
function hhmm(t: Date | string): string {
  const iso = typeof t === "string" ? t : t.toISOString()
  // "1970-01-01THH:MM:..." → "HH:MM"
  const m = /T(\d{2}:\d{2})/.exec(iso)
  return m ? m[1]! : "—"
}

const hourRange = (startHour: number, endHour: number): string =>
  `${String(startHour).padStart(2, "0")}h–${String(endHour).padStart(2, "0")}h`

/** "Time" Prisma → minutes dans [0,1440] (HH:MM). `null` si non parsable. */
function timeToMinutes(t: Date | string): number | null {
  const iso = typeof t === "string" ? t : t.toISOString()
  const m = /T(\d{2}):(\d{2})/.exec(iso)
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

/**
 * Garde-fou structurel (PAS clinique) sur la couverture horaire d'une famille
 * de créneaux. Détecte les trous (heures de la journée sans aucun créneau) et
 * les chevauchements (heures couvertes par ≥ 2 créneaux). Purement informatif :
 * une config saine couvre 0–24 h en continu, sans recouvrement.
 */
export type SlotCoverage = {
  /** Au moins une minute de la journée n'est couverte par aucun créneau. */
  hasGap: boolean
  /** Au moins deux créneaux se recouvrent. */
  hasOverlap: boolean
}

const MINUTES_PER_DAY = 1440

/** Borne une valeur de minutes dans [0,1440]. */
const clampMin = (m: number): number => Math.min(Math.max(Math.round(m), 0), MINUTES_PER_DAY)

/**
 * Analyse la couverture sur 24 h d'intervalles `[start,end)` exprimés en minutes.
 * Les intervalles qui « passent minuit » (end ≤ start) sont découpés en deux.
 * Balayage minute par minute (1440 max) — robuste pour trou + chevauchement.
 */
export function analyzeSlotCoverage(
  raw: { start: number; end: number }[],
): SlotCoverage {
  // Découpe en segments dans [0,1440), en gérant le passage minuit.
  const segments: { start: number; end: number }[] = []
  for (const r of raw) {
    const s = clampMin(r.start)
    const e = clampMin(r.end)
    if (s === e) continue // créneau dégénéré → ignoré (ni trou ni chevauchement)
    if (e > s) {
      segments.push({ start: s, end: e })
    } else {
      segments.push({ start: s, end: MINUTES_PER_DAY })
      if (e > 0) segments.push({ start: 0, end: e })
    }
  }
  if (segments.length === 0) return { hasGap: false, hasOverlap: false }

  const cover = new Uint8Array(MINUTES_PER_DAY)
  let hasOverlap = false
  for (const seg of segments) {
    for (let m = seg.start; m < seg.end; m++) {
      if (cover[m]! > 0) hasOverlap = true
      cover[m]!++
    }
  }
  let hasGap = false
  for (let m = 0; m < MINUTES_PER_DAY; m++) {
    if (cover[m] === 0) {
      hasGap = true
      break
    }
  }
  return { hasGap, hasOverlap }
}

export type Slot = { range: string; value: number }
export type BasalSlot = { range: string; rate: number }
export type TreatmentItem = { id: number; name: string | null; posology: string | null }

export type TreatmentView = {
  hasSettings: boolean
  deliveryMethod: InsulinDelivery | null
  isfSlots: Slot[] // g/L/U
  isfCoverage: SlotCoverage
  icrSlots: Slot[] // g/U
  icrCoverage: SlotCoverage
  basalSlots: BasalSlot[] // U/h (pompe)
  basalCoverage: SlotCoverage
  treatments: TreatmentItem[]
}

type SettingsInput = {
  deliveryMethod: InsulinDelivery
  sensitivityFactors: { startHour: number; endHour: number; sensitivityFactorGl: DecimalLike }[]
  carbRatios: { startHour: number; endHour: number; gramsPerUnit: DecimalLike }[]
  basalConfiguration: { pumpSlots: { startTime: Date | string; endTime: Date | string; rate: DecimalLike }[] } | null
} | null

// NB : le modèle `Treatment` n'a PAS de soft-delete (`deletedAt`) — il est
// hard-deleted en cascade depuis `Patient`. On liste donc tous les enregistrements.
type TreatmentInput = { id: number; name: string | null; posology: string | null }

export function buildTreatmentView(
  settings: SettingsInput,
  treatments: TreatmentInput[],
): TreatmentView {
  const isf = settings?.sensitivityFactors ?? []
  const icr = settings?.carbRatios ?? []
  const basal = settings?.basalConfiguration?.pumpSlots ?? []

  return {
    hasSettings: settings !== null,
    deliveryMethod: settings?.deliveryMethod ?? null,
    isfSlots: isf.map((s) => ({
      range: hourRange(s.startHour, s.endHour),
      value: num(s.sensitivityFactorGl),
    })),
    isfCoverage: analyzeSlotCoverage(
      isf.map((s) => ({ start: s.startHour * 60, end: s.endHour * 60 })),
    ),
    icrSlots: icr.map((c) => ({
      range: hourRange(c.startHour, c.endHour),
      value: num(c.gramsPerUnit),
    })),
    icrCoverage: analyzeSlotCoverage(
      icr.map((c) => ({ start: c.startHour * 60, end: c.endHour * 60 })),
    ),
    basalSlots: basal.map((p) => ({
      range: `${hhmm(p.startTime)}–${hhmm(p.endTime)}`,
      rate: num(p.rate),
    })),
    // Le débit basal pompe couvre nécessairement 24 h : on n'évalue la
    // couverture que si chaque borne est parsable (sinon créneau ignoré).
    basalCoverage: analyzeSlotCoverage(
      basal
        .map((p) => ({ start: timeToMinutes(p.startTime), end: timeToMinutes(p.endTime) }))
        .filter((s): s is { start: number; end: number } => s.start !== null && s.end !== null),
    ),
    treatments: treatments.map((t) => ({ id: t.id, name: t.name, posology: t.posology })),
  }
}
