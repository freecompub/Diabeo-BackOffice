/**
 * US-2652 — Cap patient PAR TYPE × TIER `min(%, abs_tier)` (fonction PURE). Vecteurs cliniques
 * (medical-domain-validator) : tiers pédiatrie/grossesse/standard/résistant, basale résistante significative,
 * ratios uniformes, baisse autorisée bolus / interdite basale. AC-1/AC-2 de la gate US-2652.
 */
import { describe, it, expect } from "vitest"
import {
  checkPatientChangeCap,
  patientCapType,
  patientMaxAbsDelta,
  resolvePatientCapTier,
} from "@/lib/insulin/patient-change-cap"

describe("resolvePatientCapTier (cascade le plus strict gagne)", () => {
  it("pédiatrie gagne sur tout (même DT2 pédiatrique)", () => {
    expect(resolvePatientCapTier("DT2", true, false)).toBe("PEDIATRIC")
    expect(resolvePatientCapTier("DT1", true, true)).toBe("PEDIATRIC")
  })
  it("grossesse gagne sur résistant (DT2 enceinte → PREGNANCY)", () => {
    expect(resolvePatientCapTier("DT2", false, true)).toBe("PREGNANCY")
    expect(resolvePatientCapTier("GD", false, true)).toBe("PREGNANCY")
  })
  it("DT2 non enceinte non pédiatrique → RESISTANT", () => {
    expect(resolvePatientCapTier("DT2", false, false)).toBe("RESISTANT")
  })
  it("DT1 par défaut → STANDARD", () => {
    expect(resolvePatientCapTier("DT1", false, false)).toBe("STANDARD")
  })
})

describe("patientCapType", () => {
  it("mappe les paramètres + éclate la dose fixe (both → basale stricte)", () => {
    expect(patientCapType("insulinSensitivityFactor")).toBe("isf")
    expect(patientCapType("basalRate")).toBe("basalRate")
    expect(patientCapType("fixedDose", "bolus")).toBe("fixedBolus")
    expect(patientCapType("fixedDose", "both")).toBe("fixedBasal")
    expect(() => patientCapType("unknown")).toThrow("unsupportedParameter")
  })
})

describe("patientMaxAbsDelta (min(%, abs_tier))", () => {
  it("BASALE : l'absolu varie par tier (résistant > standard > grossesse > pédiatrie)", () => {
    // Valeur haute (5,0 U/h) → l'absolu du tier borne.
    expect(patientMaxAbsDelta("basalRate", 5.0, "PEDIATRIC")).toBeCloseTo(0.05, 6)
    expect(patientMaxAbsDelta("basalRate", 5.0, "PREGNANCY")).toBeCloseTo(0.1, 6)
    expect(patientMaxAbsDelta("basalRate", 5.0, "STANDARD")).toBeCloseTo(0.15, 6)
    expect(patientMaxAbsDelta("basalRate", 5.0, "RESISTANT")).toBeCloseTo(0.25, 6)
  })
  it("RATIOS uniformes : ISF/ICR identiques quel que soit le tier", () => {
    expect(patientMaxAbsDelta("isf", 1.0, "STANDARD")).toBeCloseTo(0.05, 6)
    expect(patientMaxAbsDelta("isf", 1.0, "RESISTANT")).toBeCloseTo(0.05, 6)
    expect(patientMaxAbsDelta("icr", 20, "RESISTANT")).toBeCloseTo(1.0, 6)
  })
  it("petite valeur → le % borne quel que soit le tier (résistant sur petit ISF protégé)", () => {
    expect(patientMaxAbsDelta("isf", 0.1, "RESISTANT")).toBeCloseTo(0.01, 6) // min(0,01 ; 0,05)
    expect(patientMaxAbsDelta("basalRate", 0.3, "RESISTANT")).toBeCloseTo(0.03, 6) // min(0,03 ; 0,25)
  })
})

describe("checkPatientChangeCap", () => {
  it("SCÉNARIO résistant (basale 5,0 U/h) : +0,25 OK, +0,30 refusé — pas significatif ET borné", () => {
    expect(checkPatientChangeCap("basalRate", 5.0, 5.25, "RESISTANT")).toBeNull()
    expect(checkPatientChangeCap("basalRate", 5.0, 5.3, "RESISTANT")).toBe("patientDeltaTooLarge")
  })
  it("même basale 5,0 en STANDARD : plafonné plus serré à +0,15", () => {
    expect(checkPatientChangeCap("basalRate", 5.0, 5.15, "STANDARD")).toBeNull()
    expect(checkPatientChangeCap("basalRate", 5.0, 5.25, "STANDARD")).toBe("patientDeltaTooLarge")
  })
  it("basale pompe : BAISSE interdite (tous tiers)", () => {
    expect(checkPatientChangeCap("basalRate", 5.0, 4.9, "RESISTANT")).toBe("patientDecreaseForbidden")
  })
  it("dose fixe BASALE : baisse interdite ; RESISTANT abs 1,5 U (dose 40 U)", () => {
    expect(checkPatientChangeCap("fixedBasal", 40, 39, "RESISTANT")).toBe("patientDecreaseForbidden")
    expect(checkPatientChangeCap("fixedBasal", 40, 41.5, "RESISTANT")).toBeNull() // +1,5 = abs résistant
    expect(checkPatientChangeCap("fixedBasal", 40, 42, "RESISTANT")).toBe("patientDeltaTooLarge") // +2,0 > 1,5
  })
  it("dose fixe BOLUS : baisse pour hypo LÉGITIME (capée) ; pédiatrie 0,5 U plus stricte que standard 1,0", () => {
    expect(checkPatientChangeCap("fixedBolus", 40, 39, "STANDARD")).toBeNull() // −1,0 = abs standard
    expect(checkPatientChangeCap("fixedBolus", 12, 11.5, "PEDIATRIC")).toBeNull() // −0,5 = abs pédiatrie
    expect(checkPatientChangeCap("fixedBolus", 12, 11, "PEDIATRIC")).toBe("patientDeltaTooLarge") // −1,0 > 0,5
  })
  it("ISF baisse : symétrique, cap uniforme 0,05 (tous tiers)", () => {
    expect(checkPatientChangeCap("isf", 0.5, 0.46, "RESISTANT")).toBeNull() // −0,04 ≤ 0,05
    expect(checkPatientChangeCap("isf", 0.5, 0.42, "RESISTANT")).toBe("patientDeltaTooLarge") // −0,08 > 0,05
  })
})
