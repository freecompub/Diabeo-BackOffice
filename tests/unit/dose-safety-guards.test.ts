/**
 * Garde de sécurité partagée (fenêtre glycémique) — garde HYPO utilisée par le générateur de propositions.
 * Comportement clinique testé : bloque une hausse d'insuline sur un signal hypo récent (sévère OU récurrent).
 */
import { describe, it, expect } from "vitest"
import { hypoWindowBlocks } from "@/lib/insulin/dose-safety-guards"

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
