/**
 * US-2652 — Cap patient PAR TYPE `min(%, absolu)` (fonction PURE). Vecteurs cliniques
 * (medical-domain-validator) : petit ISF, grosse basale, ICR élevé, dose fixe pédiatrique, baisse
 * autorisée bolus / interdite basale. AC-1/AC-2 de la gate US-2652.
 */
import { describe, it, expect } from "vitest"
import { checkPatientChangeCap, patientCapType, patientMaxAbsDelta } from "@/lib/insulin/patient-change-cap"

describe("patientCapType", () => {
  it("mappe les paramètres + éclate la dose fixe par kind (both → basale stricte)", () => {
    expect(patientCapType("insulinSensitivityFactor")).toBe("isf")
    expect(patientCapType("insulinToCarbRatio")).toBe("icr")
    expect(patientCapType("basalRate")).toBe("basalRate")
    expect(patientCapType("fixedDose", "bolus")).toBe("fixedBolus")
    expect(patientCapType("fixedDose", "basal")).toBe("fixedBasal")
    expect(patientCapType("fixedDose", "both")).toBe("fixedBasal")
    expect(() => patientCapType("unknown")).toThrow("unsupportedParameter")
  })
})

describe("patientMaxAbsDelta (min(%, abs))", () => {
  it("petit ISF 0,10 → le % borne (min(0,01 ; 0,05) = 0,01)", () => {
    expect(patientMaxAbsDelta("isf", 0.1, false)).toBeCloseTo(0.01, 6)
  })
  it("grosse basale 3,0 U/h → l'absolu borne (min(0,30 ; 0,10) = 0,10)", () => {
    expect(patientMaxAbsDelta("basalRate", 3.0, false)).toBeCloseTo(0.1, 6)
  })
  it("ICR 20 → l'absolu borne (min(2,0 ; 1,0) = 1,0)", () => {
    expect(patientMaxAbsDelta("icr", 20, false)).toBeCloseTo(1.0, 6)
  })
  it("dose fixe bolus 40 U adulte → 1,0 U ; pédiatrie → 0,5 U", () => {
    expect(patientMaxAbsDelta("fixedBolus", 40, false)).toBeCloseTo(1.0, 6)
    expect(patientMaxAbsDelta("fixedBolus", 40, true)).toBeCloseTo(0.5, 6)
  })
})

describe("checkPatientChangeCap", () => {
  it("ISF baisse dans le cap → OK (symétrique)", () => {
    expect(checkPatientChangeCap("isf", 0.5, 0.46, false)).toBeNull() // −0,04 ≤ min(0,05 ; 0,05)
  })
  it("ISF baisse hors cap → patientDeltaTooLarge", () => {
    expect(checkPatientChangeCap("isf", 0.5, 0.42, false)).toBe("patientDeltaTooLarge") // −0,08 > 0,05
  })
  it("grosse basale : hausse 0,10 OK, 0,20 refusée (l'absolu borne)", () => {
    expect(checkPatientChangeCap("basalRate", 3.0, 3.1, false)).toBeNull()
    expect(checkPatientChangeCap("basalRate", 3.0, 3.2, false)).toBe("patientDeltaTooLarge")
  })
  it("basale pompe : BAISSE interdite (quel que soit le montant)", () => {
    expect(checkPatientChangeCap("basalRate", 1.0, 0.99, false)).toBe("patientDecreaseForbidden")
  })
  it("dose fixe BASALE : baisse interdite (nouvelle règle US-2652)", () => {
    expect(checkPatientChangeCap("fixedBasal", 40, 39, false)).toBe("patientDecreaseForbidden")
  })
  it("dose fixe BOLUS 40 U : baisse pour hypo LÉGITIME (capée par l'absolu 1,0, pas interdite)", () => {
    expect(checkPatientChangeCap("fixedBolus", 40, 39, false)).toBeNull() // −1,0 = min(4,0 ; 1,0)
    expect(checkPatientChangeCap("fixedBolus", 40, 38, false)).toBe("patientDeltaTooLarge") // −2,0 > 1,0
  })
  it("dose fixe bolus 12 U : cap pédiatrique 0,5 U plus strict que l'adulte 1,0 U (10 % = 1,2 > les deux)", () => {
    expect(checkPatientChangeCap("fixedBolus", 12, 11, false)).toBeNull() // adulte : −1,0 = min(1,2 ; 1,0)
    expect(checkPatientChangeCap("fixedBolus", 12, 10.5, false)).toBe("patientDeltaTooLarge") // adulte : −1,5 > 1,0
    expect(checkPatientChangeCap("fixedBolus", 12, 11.5, true)).toBeNull() // pédiatrie : −0,5 = min(1,2 ; 0,5)
    expect(checkPatientChangeCap("fixedBolus", 12, 11, true)).toBe("patientDeltaTooLarge") // pédiatrie : −1,0 > 0,5
  })
  it("tolérance FP au seuil (exactement au cap → OK)", () => {
    expect(checkPatientChangeCap("icr", 20, 21, false)).toBeNull() // +1,0 exactement = cap absolu
  })
})
