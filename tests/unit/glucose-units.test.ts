/**
 * Verrou de comportement du module de conversion d'unités glycémiques (ADR #32).
 *
 * `src/lib/glucose/units.ts` est la SOURCE DE VÉRITÉ UNIQUE des conversions
 * `g/L ↔ mg/dL ↔ mmol/L`. Ce test verrouille :
 *  - la convention Diabeo `1 g/L = 100 mg/dL` (jamais ×18) ;
 *  - le round-trip **sans perte** g/L → mg/dL → g/L (Decimal(6,4) ↔ Decimal(6,2)) ;
 *  - le facteur molaire mmol/L (÷18,0182), réservé à l'affichage ;
 *  - la précision d'affichage par unité de `formatGlucose`.
 *
 * Comportement clinique testé : toute mesure stockée en g/L doit se convertir de
 * façon déterministe et réversible vers les unités d'affichage — une dérive de
 * conversion fausserait l'affichage patient/soignant (risque de mauvaise décision).
 *
 * @see docs/architecture/adr-normalisation-unites-glycemie.md
 */

import { describe, it, expect } from "vitest"
import {
  MGDL_PER_GL,
  MGDL_PER_MMOLL,
  glToMgdl,
  mgdlToGl,
  mgdlToMmoll,
  glToMmoll,
  glucoseUnitLabel,
  formatGlucose,
  formatGlucoseFromMgdl,
  mgdlToDisplayValue,
} from "@/lib/glucose/units"

describe("constantes de conversion", () => {
  it("convention Diabeo : 1 g/L = 100 mg/dL (jamais ×18)", () => {
    expect(MGDL_PER_GL).toBe(100)
  })

  it("facteur molaire du glucose = 18,0182 mg/dL par mmol/L", () => {
    expect(MGDL_PER_MMOLL).toBe(18.0182)
  })
})

describe("glToMgdl / mgdlToGl", () => {
  it.each([
    [0.4, 40],
    [0.7, 70],
    [1.0, 100],
    [1.2, 120],
    [1.8, 180],
    [2.5, 250],
    [6.0, 600],
  ])("glToMgdl(%f g/L) = %d mg/dL", (gl, mgdl) => {
    expect(glToMgdl(gl)).toBeCloseTo(mgdl, 10)
  })

  it("round-trip g/L → mg/dL → g/L est sans perte sur la précision Decimal(6,4)", () => {
    // value_gl = Decimal(6,4) : au plus 4 décimales. ×100 tient dans Decimal(6,2).
    for (const gl of [0.2, 0.4055, 0.7, 1.2345, 1.8, 4.0, 6.0]) {
      expect(mgdlToGl(glToMgdl(gl))).toBeCloseTo(gl, 10)
    }
  })
})

describe("conversion mmol/L (affichage SI uniquement)", () => {
  it("mgdlToMmoll(180) ≈ 9,99 mmol/L", () => {
    expect(mgdlToMmoll(180)).toBeCloseTo(9.9899, 3)
  })

  it("glToMmoll(1,80 g/L) = mgdlToMmoll(180)", () => {
    expect(glToMmoll(1.8)).toBeCloseTo(mgdlToMmoll(180), 10)
  })
})

describe("glucoseUnitLabel", () => {
  it.each([
    [3, "g/L"],
    [4, "mg/dL"],
    [5, "mmol/L"],
  ] as const)("code %d → %s", (code, label) => {
    expect(glucoseUnitLabel(code)).toBe(label)
  })
})

describe("formatGlucose — précision d'affichage par unité", () => {
  it("g/L (code 3) : 2 décimales", () => {
    expect(formatGlucose(1.234, 3)).toEqual({ value: 1.23, unit: "g/L" })
  })

  it("mg/dL (code 4) : entier arrondi", () => {
    expect(formatGlucose(1.204, 4)).toEqual({ value: 120, unit: "mg/dL" })
  })

  it("mmol/L (code 5) : 1 décimale", () => {
    expect(formatGlucose(1.8, 5)).toEqual({ value: 10, unit: "mmol/L" })
  })

  it("défaut = mg/dL quand le code est omis", () => {
    expect(formatGlucose(1.0)).toEqual({ value: 100, unit: "mg/dL" })
  })
})

describe("formatGlucoseFromMgdl — entrée mg/dL (charts/analytics)", () => {
  it.each([
    [180, 4, { value: 180, unit: "mg/dL" }],
    [180, 3, { value: 1.8, unit: "g/L" }],
    [180, 5, { value: 10, unit: "mmol/L" }],
    [70, 3, { value: 0.7, unit: "g/L" }],
  ] as const)("formatGlucoseFromMgdl(%d, %d)", (mgdl, code, expected) => {
    expect(formatGlucoseFromMgdl(mgdl, code)).toEqual(expected)
  })

  it("cohérence avec formatGlucose via mgdlToGl", () => {
    expect(formatGlucoseFromMgdl(180, 5)).toEqual(formatGlucose(mgdlToGl(180), 5))
  })
})

describe("mgdlToDisplayValue — nombre seul pour tickFormatter/tooltip", () => {
  it.each([
    [180, 4, 180],
    [180, 3, 1.8],
    [180, 5, 10],
    [54, 4, 54],
  ] as const)("mgdlToDisplayValue(%d, %d) = %f", (mgdl, code, expected) => {
    expect(mgdlToDisplayValue(mgdl, code)).toBe(expected)
  })
})
