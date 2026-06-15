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

export type Slot = { range: string; value: number }
export type BasalSlot = { range: string; rate: number }
export type TreatmentItem = { id: number; name: string | null; posology: string | null }

export type TreatmentView = {
  hasSettings: boolean
  deliveryMethod: InsulinDelivery | null
  isfSlots: Slot[] // g/L/U
  icrSlots: Slot[] // g/U
  basalSlots: BasalSlot[] // U/h (pompe)
  treatments: TreatmentItem[]
}

type SettingsInput = {
  deliveryMethod: InsulinDelivery
  sensitivityFactors: { startHour: number; endHour: number; sensitivityFactorGl: DecimalLike }[]
  carbRatios: { startHour: number; endHour: number; gramsPerUnit: DecimalLike }[]
  basalConfiguration: { pumpSlots: { startTime: Date | string; endTime: Date | string; rate: DecimalLike }[] } | null
} | null

type TreatmentInput = { id: number; name: string | null; posology: string | null; deletedAt?: Date | null }

export function buildTreatmentView(
  settings: SettingsInput,
  treatments: TreatmentInput[],
): TreatmentView {
  return {
    hasSettings: settings !== null,
    deliveryMethod: settings?.deliveryMethod ?? null,
    isfSlots: (settings?.sensitivityFactors ?? []).map((s) => ({
      range: hourRange(s.startHour, s.endHour),
      value: num(s.sensitivityFactorGl),
    })),
    icrSlots: (settings?.carbRatios ?? []).map((c) => ({
      range: hourRange(c.startHour, c.endHour),
      value: num(c.gramsPerUnit),
    })),
    basalSlots: (settings?.basalConfiguration?.pumpSlots ?? []).map((p) => ({
      range: `${hhmm(p.startTime)}–${hhmm(p.endTime)}`,
      rate: num(p.rate),
    })),
    treatments: treatments
      .filter((t) => !t.deletedAt)
      .map((t) => ({ id: t.id, name: t.name, posology: t.posology })),
  }
}
