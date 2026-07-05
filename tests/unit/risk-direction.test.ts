/**
 * US-2649b — Direction de risque clinique d'une proposition (helper pur).
 * « Plus d'insuline » = risque hypo : hausse basale/dose fixe, ou baisse ISF/ICR.
 */
import { describe, it, expect } from "vitest"
import { deriveRiskDirection } from "@/lib/insulin/risk-direction"

describe("deriveRiskDirection", () => {
  it("basalRate : hausse → hypo, baisse → hyper", () => {
    expect(deriveRiskDirection("basalRate", 1.0, 1.2)).toBe("hypo")
    expect(deriveRiskDirection("basalRate", 1.0, 0.8)).toBe("hyper")
  })
  it("fixedDose : hausse → hypo", () => {
    expect(deriveRiskDirection("fixedDose", 10, 12)).toBe("hypo")
  })
  it("ISF : baisse → hypo (correction plus forte), hausse → hyper", () => {
    expect(deriveRiskDirection("insulinSensitivityFactor", 0.5, 0.4)).toBe("hypo")
    expect(deriveRiskDirection("insulinSensitivityFactor", 0.5, 0.6)).toBe("hyper")
  })
  it("ICR : baisse → hypo (plus d'insuline/gramme), hausse → hyper", () => {
    expect(deriveRiskDirection("insulinToCarbRatio", 10, 8)).toBe("hypo")
    expect(deriveRiskDirection("insulinToCarbRatio", 10, 12)).toBe("hyper")
  })
  it("écart nul ou non fini → none", () => {
    expect(deriveRiskDirection("basalRate", 1.0, 1.0)).toBe("none")
    expect(deriveRiskDirection("insulinToCarbRatio", 10, NaN)).toBe("none")
  })
  it("paramètre inconnu → none (fail-closed, pas de verdict deviné)", () => {
    expect(deriveRiskDirection("somethingElse", 1.0, 2.0)).toBe("none")
  })
})
