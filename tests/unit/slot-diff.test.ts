/**
 * US-2663 (S2) — DIFF pur (live → proposé) pour l'écran de revue médecin (`slot-diff.ts`).
 *
 * Comportement clinique testé : une ligne PAR créneau PROPOSÉ, annotée de sa valeur live appariée par
 * `startHour` ; `changed` si la valeur, la borne de fin, ou la présence même du créneau live diffère (au-delà
 * de la tolérance flottante `BASELINE_VALUE_EPS`). `hasStructuralChange` signale en complément une
 * suppression de créneau (côté live, absent du proposé) que `diffSlots` seul ne rend pas visible (il n'itère
 * que sur le côté proposé).
 */
import { describe, it, expect } from "vitest"
import { diffSlots, hasStructuralChange } from "@/lib/insulin/slot-diff"
import { BASELINE_VALUE_EPS } from "@/lib/insulin/slot-baseline-cas"

const LIVE = [
  { startHour: 0, endHour: 8, value: 0.5 },
  { startHour: 8, endHour: 22, value: 0.45 },
  { startHour: 22, endHour: 0, value: 0.4 },
]

describe("diffSlots", () => {
  it("jeu identique → toutes les lignes non `changed`, `liveValue` apparié", () => {
    const rows = diffSlots(LIVE, [...LIVE])
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => !r.changed)).toBe(true)
    expect(rows.map((r) => r.liveValue)).toEqual([0.5, 0.45, 0.4])
  })

  it("trie les lignes par startHour (jeu proposé désordonné)", () => {
    const shuffled = [LIVE[2], LIVE[0], LIVE[1]]
    const rows = diffSlots(LIVE, shuffled)
    expect(rows.map((r) => r.startHour)).toEqual([0, 8, 22])
  })

  it("écart de valeur sous la tolérance flottante → non `changed`", () => {
    const proposed = LIVE.map((s, i) => (i === 0 ? { ...s, value: s.value + BASELINE_VALUE_EPS / 2 } : s))
    const rows = diffSlots(LIVE, proposed)
    expect(rows[0]!.changed).toBe(false)
  })

  it("valeur différente sur un créneau → `changed` UNIQUEMENT sur ce créneau", () => {
    const proposed = LIVE.map((s, i) => (i === 1 ? { ...s, value: 0.6 } : s))
    const rows = diffSlots(LIVE, proposed)
    expect(rows[0]!.changed).toBe(false)
    expect(rows[1]!.changed).toBe(true)
    expect(rows[1]!.proposedValue).toBe(0.6)
    expect(rows[1]!.liveValue).toBe(0.45)
    expect(rows[2]!.changed).toBe(false)
  })

  it("borne de fin différente → `changed`", () => {
    const proposed = LIVE.map((s, i) => (i === 0 ? { ...s, endHour: 9 } : s))
    const rows = diffSlots(LIVE, proposed)
    expect(rows[0]!.changed).toBe(true)
  })

  it("créneau proposé sans correspondance live (startHour nouveau) → `liveValue` null, `changed` true", () => {
    const proposed = [{ startHour: 5, endHour: 8, value: 0.55 }, ...LIVE.slice(1)]
    const rows = diffSlots(LIVE, proposed)
    const newRow = rows.find((r) => r.startHour === 5)
    expect(newRow?.liveValue).toBeNull()
    expect(newRow?.changed).toBe(true)
  })

  it("mealLabel (ICR) porté sur la ligne quand présent", () => {
    const rows = diffSlots(
      [{ startHour: 0, endHour: 12, value: 10, mealLabel: "midi" }],
      [{ startHour: 0, endHour: 12, value: 10, mealLabel: "midi" }],
    )
    expect(rows[0]!.mealLabel).toBe("midi")
  })

  it("jeu proposé VIDE → aucune ligne côté proposé, mais les créneaux live supprimés sont rendus (removed)", () => {
    const rows = diffSlots(LIVE, [])
    expect(rows).toHaveLength(3) // les 3 créneaux live deviennent des lignes « supprimées »
    expect(rows.every((r) => r.removed && r.proposedValue === null && r.changed)).toBe(true)
    expect(rows.map((r) => r.liveValue)).toEqual([0.5, 0.45, 0.4])
  })

  it("config live VIDE → chaque créneau proposé est `changed` avec `liveValue` null (aucune suppression)", () => {
    const rows = diffSlots([], LIVE)
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.changed && r.liveValue === null && !r.removed)).toBe(true)
  })

  it("garde NaN : une valeur LIVE non finie force `changed` (jamais « inchangé » silencieux)", () => {
    const proposed = [{ startHour: 0, endHour: 8, value: 0.5 }]
    const rows = diffSlots([{ startHour: 0, endHour: 8, value: Number.NaN }], proposed)
    expect(rows[0]!.changed).toBe(true)
  })

  it("créneau LIVE SUPPRIMÉ (absent du proposé) → ligne dédiée `removed`, triée par startHour", () => {
    // Proposé retire le créneau 8→22 ; garde 0→8 et 22→0.
    const proposed = [LIVE[0]!, LIVE[2]!]
    const rows = diffSlots(LIVE, proposed)
    expect(rows.map((r) => r.startHour)).toEqual([0, 8, 22]) // le supprimé (8) réinséré à sa place
    const removed = rows.find((r) => r.startHour === 8)!
    expect(removed.removed).toBe(true)
    expect(removed.proposedValue).toBeNull()
    expect(removed.liveValue).toBe(0.45)
    expect(removed.changed).toBe(true)
  })
})

describe("hasStructuralChange", () => {
  it("même cardinalité, mêmes startHour → false", () => {
    expect(hasStructuralChange(LIVE, [...LIVE])).toBe(false)
  })

  it("cardinalité différente (créneau supprimé côté proposé) → true", () => {
    expect(hasStructuralChange(LIVE, LIVE.slice(0, 2))).toBe(true)
  })

  it("même cardinalité mais un créneau LIVE absent du proposé (déplacé) → true", () => {
    const proposed = [{ startHour: 1, endHour: 8, value: 0.5 }, LIVE[1]!, LIVE[2]!]
    expect(hasStructuralChange(LIVE, proposed)).toBe(true)
  })

  it("un créneau proposé en plus (cardinalité différente) → true", () => {
    expect(hasStructuralChange(LIVE, [...LIVE, { startHour: 6, endHour: 8, value: 0.3 }])).toBe(true)
  })
})
