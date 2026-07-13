/**
 * US-2663 (S1) — CAS d'ensemble fail-closed (`assertBaselineUnchanged`, `src/lib/insulin/slot-baseline-cas.ts`).
 *
 * Comportement clinique testé : à l'acceptation d'une proposition groupée, la base ACTIVE doit être identique
 * au snapshot pris à la génération. Toute dérive (valeur, borne, structure) → `baselineMoved` (on ne peut pas
 * appliquer un jeu périmé qui écraserait un ajustement médecin concurrent). Snapshot absent → `baselineMissing`
 * (fail-closed). Un relibellé de créneau (`mealLabel`) N'EST PAS une dérive dosante → accepté.
 */
import { describe, it, expect } from "vitest"
import { assertBaselineUnchanged, assertBaselineUnchangedBy, isBaselineUnchanged, BASELINE_VALUE_EPS } from "@/lib/insulin/slot-baseline-cas"

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

  it("valeur LIVE non finie (NaN — corruption) → baselineMoved (fail-closed, pas 'inchangé' silencieux)", () => {
    const live = BASE.map((s, i) => (i === 0 ? { ...s, value: NaN } : s))
    expect(() => assertBaselineUnchanged(BASE, live)).toThrow("baselineMoved")
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

describe("isBaselineUnchanged — variante non-throwing (affichage, US-2663 S2)", () => {
  it("base identique → true", () => {
    expect(isBaselineUnchanged(BASE, [...BASE])).toBe(true)
  })

  it("valeur dérivée (ajustement médecin concurrent) → false", () => {
    const live = BASE.map((s, i) => (i === 1 ? { ...s, value: 0.6 } : s))
    expect(isBaselineUnchanged(BASE, live)).toBe(false)
  })

  it("snapshot ABSENT (`null`, legacy ou JSON non parsable) → false (non certifiable, jamais 'inchangé')", () => {
    expect(isBaselineUnchanged(null, BASE)).toBe(false)
  })
})

// US-2663 (S3c/S3d) — CAS générique par clé pour les formes non-ISF/ICR (pompe/stylo/dose fixe).
describe("assertBaselineUnchangedBy — CAS générique par clé", () => {
  it("POMPE (clé startTime, borne endTime, valeur rate) : identique → OK, débit dérivé → baselineMoved", () => {
    const opts = { keyOf: (s: { startTime: string }) => s.startTime, valueOf: (s: { rate: number }) => s.rate, boundEq: (l: { endTime: string }, b: { endTime: string }) => l.endTime === b.endTime }
    const base = [{ startTime: "00:00", endTime: "06:00", rate: 0.8 }, { startTime: "06:00", endTime: "00:00", rate: 1.1 }]
    expect(() => assertBaselineUnchangedBy(base, [...base], opts)).not.toThrow()
    // débit du créneau nocturne dérivé (0,8 → 0,85)
    expect(() => assertBaselineUnchangedBy(base, [{ ...base[0]!, rate: 0.85 }, base[1]!], opts)).toThrow("baselineMoved")
    // borne endTime déplacée (restructuration horaire)
    expect(() => assertBaselineUnchangedBy(base, [{ ...base[0]!, endTime: "05:30" }, base[1]!], opts)).toThrow("baselineMoved")
  })

  it("STYLO (clé kind, sans borne) : split identique → OK, cardinalité single↔split → baselineMoved", () => {
    const opts = { keyOf: (s: { kind: string }) => s.kind, valueOf: (s: { value: number }) => s.value }
    const split = [{ kind: "morning", value: 12 }, { kind: "evening", value: 10 }]
    expect(() => assertBaselineUnchangedBy(split, [split[1]!, split[0]!], opts)).not.toThrow() // ré-ordonné = OK
    expect(() => assertBaselineUnchangedBy(split, [{ kind: "evening", value: 10 }], opts)).toThrow("baselineMoved") // cardinalité
    expect(() => assertBaselineUnchangedBy(split, [{ kind: "morning", value: 13 }, split[1]!], opts)).toThrow("baselineMoved") // dose dérivée
  })

  it("DOSE FIXE (clé moment, sans borne) : identique → OK, moment disparu → baselineMoved", () => {
    const opts = { keyOf: (s: { moment: string }) => s.moment, valueOf: (s: { value: number }) => s.value }
    const base = [{ moment: "morning", value: 8 }, { moment: "evening", value: 6 }]
    expect(() => assertBaselineUnchangedBy(base, [...base], opts)).not.toThrow()
    expect(() => assertBaselineUnchangedBy(base, [{ moment: "morning", value: 8 }, { moment: "noon", value: 6 }], opts)).toThrow("baselineMoved")
  })

  it("fail-closed : snapshot null → baselineMissing ; valeur non finie → baselineMoved", () => {
    const opts = { keyOf: (s: { kind: string }) => s.kind, valueOf: (s: { value: number }) => s.value }
    expect(() => assertBaselineUnchangedBy(null, [{ kind: "daily", value: 20 }], opts)).toThrow("baselineMissing")
    expect(() => assertBaselineUnchangedBy([{ kind: "daily", value: NaN }], [{ kind: "daily", value: 20 }], opts)).toThrow("baselineMoved")
  })
})
