/**
 * US-2663 (S1) — CAS d'ensemble fail-closed (`assertBaselineUnchanged`, `src/lib/insulin/slot-baseline-cas.ts`).
 *
 * Comportement clinique testé : à l'acceptation d'une proposition groupée, la base ACTIVE doit être identique
 * au snapshot pris à la génération. Toute dérive (valeur, borne, structure) → `baselineMoved` (on ne peut pas
 * appliquer un jeu périmé qui écraserait un ajustement médecin concurrent). Snapshot absent → `baselineMissing`
 * (fail-closed). Un relibellé de créneau (`mealLabel`) N'EST PAS une dérive dosante → accepté.
 */
import { describe, it, expect } from "vitest"
import { assertBaselineUnchanged, BASELINE_VALUE_EPS } from "@/lib/insulin/slot-baseline-cas"

const BASE = [
  { startHour: 0, endHour: 8, value: 0.5 },
  { startHour: 8, endHour: 22, value: 0.45 },
  { startHour: 22, endHour: 0, value: 0.4 },
]

describe("assertBaselineUnchanged — CAS d'ensemble", () => {
  it("base identique → ne lève pas", () => {
    expect(() => assertBaselineUnchanged(BASE, [...BASE])).not.toThrow()
  })

  it("base identique mais RÉ-ORDONNÉE → ne lève pas (appariement par startHour, pas par position)", () => {
    const shuffled = [BASE[2], BASE[0], BASE[1]]
    expect(() => assertBaselineUnchanged(BASE, shuffled)).not.toThrow()
  })

  it("écart de valeur sous la tolérance flottante → ne lève pas", () => {
    const live = BASE.map((s, i) => (i === 0 ? { ...s, value: s.value + BASELINE_VALUE_EPS / 2 } : s))
    expect(() => assertBaselineUnchanged(BASE, live)).not.toThrow()
  })

  it("VALEUR d'un créneau modifiée (ajustement médecin concurrent) → baselineMoved", () => {
    const live = BASE.map((s, i) => (i === 1 ? { ...s, value: 0.6 } : s))
    expect(() => assertBaselineUnchanged(BASE, live)).toThrow("baselineMoved")
  })

  it("BORNE de fin déplacée → baselineMoved", () => {
    const live = BASE.map((s, i) => (i === 0 ? { ...s, endHour: 9 } : s))
    expect(() => assertBaselineUnchanged(BASE, live)).toThrow("baselineMoved")
  })

  it("STRUCTURE : créneau supprimé (cardinalité différente) → baselineMoved", () => {
    expect(() => assertBaselineUnchanged(BASE, BASE.slice(0, 2))).toThrow("baselineMoved")
  })

  it("STRUCTURE : même cardinalité mais startHour différent (créneau déplacé) → baselineMoved", () => {
    const live = BASE.map((s, i) => (i === 0 ? { ...s, startHour: 1 } : s))
    expect(() => assertBaselineUnchanged(BASE, live)).toThrow("baselineMoved")
  })

  it("relibellé mealLabel (ICR) SANS changement de dose → ne lève pas (étiquette non dosante)", () => {
    const base = [{ startHour: 0, endHour: 12, value: 10, mealLabel: "midi" }, { startHour: 12, endHour: 0, value: 12 }]
    const live = [{ startHour: 0, endHour: 12, value: 10, mealLabel: "déjeuner" }, { startHour: 12, endHour: 0, value: 12 }]
    expect(() => assertBaselineUnchanged(base, live)).not.toThrow()
  })

  it("snapshot ABSENT (proposition legacy) → baselineMissing (fail-closed)", () => {
    expect(() => assertBaselineUnchanged(null, BASE)).toThrow("baselineMissing")
  })

  it("base vide `[]` vs live vide `[]` → ne lève pas (médecin parti de zéro, aucune dérive)", () => {
    expect(() => assertBaselineUnchanged([], [])).not.toThrow()
  })

  it("base vide `[]` mais un créneau est apparu (édit médecin concurrent) → baselineMoved", () => {
    expect(() => assertBaselineUnchanged([], [BASE[0]])).toThrow("baselineMoved")
  })
})
