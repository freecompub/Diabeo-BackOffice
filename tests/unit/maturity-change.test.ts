/**
 * US-2657 (A2) — Logique pure du message de confirmation de changement de maturité.
 */
import { describe, it, expect } from "vitest"
import { maturityChangeMessageKey, MATURITY_RANK } from "@/components/diabeo/patient/maturity-change"

describe("maturityChangeMessageKey", () => {
  it("montée JUNIOR → INTERMEDIATE : capacité créneaux", () => {
    expect(maturityChangeMessageKey("JUNIOR", "INTERMEDIATE")).toBe("maturityGrantSlots")
  })
  it("montée vers CONFIRME : capacité refuser/contre-proposer", () => {
    expect(maturityChangeMessageKey("JUNIOR", "CONFIRME")).toBe("maturityGrantConfirme")
    expect(maturityChangeMessageKey("INTERMEDIATE", "CONFIRME")).toBe("maturityGrantConfirme")
  })
  it("descente : note de retrait", () => {
    expect(maturityChangeMessageKey("CONFIRME", "INTERMEDIATE")).toBe("maturityDowngradeNote")
    expect(maturityChangeMessageKey("INTERMEDIATE", "JUNIOR")).toBe("maturityDowngradeNote")
    expect(maturityChangeMessageKey("CONFIRME", "JUNIOR")).toBe("maturityDowngradeNote")
  })
  it("ordre des crans", () => {
    expect(MATURITY_RANK.JUNIOR).toBeLessThan(MATURITY_RANK.INTERMEDIATE)
    expect(MATURITY_RANK.INTERMEDIATE).toBeLessThan(MATURITY_RANK.CONFIRME)
  })
})
