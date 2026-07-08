/**
 * US-2657 (slice B) — Gardes de sécurité partagées (fenêtre glycémique).
 * Comportement clinique testé : garde HYPO (bloque une hausse d'insuline) et garde HYPER/cétose
 * asymétrique (bloque une BAISSE d'insuline, plancher de suffisance + signaux positifs).
 */
import { describe, it, expect } from "vitest"
import { hypoWindowBlocks, hyperDecreaseBlockReason } from "@/lib/insulin/dose-safety-guards"

describe("hypoWindowBlocks", () => {
  it("une hypo sévère (< 0,54 g/L) suffit à bloquer", () => {
    expect(hypoWindowBlocks([1.2, 0.5, 1.4])).toBe(true)
  })
  it("≥ 2 hypos niveau 1 (< 0,70) bloquent (récurrence)", () => {
    expect(hypoWindowBlocks([0.65, 1.2, 0.68])).toBe(true)
  })
  it("une seule hypo niveau 1 ne bloque pas", () => {
    expect(hypoWindowBlocks([0.65, 1.2, 1.4])).toBe(false)
  })
  it("aucune hypo → ne bloque pas ; fenêtre vide → ne bloque pas", () => {
    expect(hypoWindowBlocks([1.2, 1.4, 1.1])).toBe(false)
    expect(hypoWindowBlocks([])).toBe(false)
  })
})

describe("hyperDecreaseBlockReason (garde C6b, sur une baisse d'insuline)", () => {
  const KETONE = 1.5
  // Fenêtre suffisante : 14 j, capture 70 %.
  const okFloor = { windowDays: 14, capture: 70 }
  const wellControlled = Array(100).fill(1.2) // tout in-range

  it("plancher : fenêtre trop courte → insufficientData (baisse interdite)", () => {
    expect(hyperDecreaseBlockReason(wellControlled, 70, 5, [], KETONE)).toBe("insufficientData")
  })
  it("plancher : capture insuffisante (BGM/faible) → insufficientData", () => {
    expect(hyperDecreaseBlockReason(wellControlled, 40, 14, [], KETONE)).toBe("insufficientData")
  })
  it("cétose récente ≥ seuil modéré → ketosis (prioritaire)", () => {
    expect(hyperDecreaseBlockReason(wellControlled, okFloor.capture, okFloor.windowDays, [1.6], KETONE)).toBe("ketosis")
  })
  it("cétone sous le seuil → pas de blocage cétose", () => {
    expect(hyperDecreaseBlockReason(wellControlled, 70, 14, [0.8], KETONE)).toBeNull()
  })
  it("hyper sévère : > 10 % du temps > 2,50 g/L → severeHyper", () => {
    // 15 relevés > 2,50 sur 100 → hyper 15 %
    const g = [...Array(15).fill(3.0), ...Array(85).fill(1.2)]
    expect(hyperDecreaseBlockReason(g, 70, 14, [], KETONE)).toBe("severeHyper")
  })
  it("hyper soutenue : > 30 % du temps > 1,80 g/L (sans sévère) → sustainedHyper", () => {
    // 40 relevés à 2,00 (bande 1,80–2,50 = elevated), 60 in-range → elevated 40 %, hyper 0 %
    const g = [...Array(40).fill(2.0), ...Array(60).fill(1.2)]
    expect(hyperDecreaseBlockReason(g, 70, 14, [], KETONE)).toBe("sustainedHyper")
  })
  it("patient bien contrôlé, fenêtre suffisante, pas de cétone → null (baisse autorisée)", () => {
    expect(hyperDecreaseBlockReason(wellControlled, 70, 14, [], KETONE)).toBeNull()
  })
})
