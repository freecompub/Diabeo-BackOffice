/**
 * US-2657 (slice B) — Enveloppe de sécurité de l'auto-application experte.
 *
 * Comportement clinique/sécurité testé : hors enveloppe → PROPOSITION (fail-safe) ; valeur hors bornes →
 * REJET DUR ; garde hypo (hausse) / hyper-cétose (baisse) ; anti-cliquet ; fail-closed sur donnée manquante.
 * Le cas le plus dangereux (baisse d'insuline en hyper/données insuffisantes) doit TOUJOURS retomber en proposition.
 */
import { describe, it, expect } from "vitest"
import { evaluateAutoApplyEnvelope, type EnvelopeInput } from "@/lib/insulin/auto-apply-envelope"

/** Base AUTO_APPLY : ISF 0,50→0,48 (hausse d'insuline, direction hypo), fenêtre saine, expert + flag ON. */
function base(over: Partial<EnvelopeInput> = {}): EnvelopeInput {
  return {
    authority: { maturityLevel: "EXPERT", autoApply: true },
    change: { parameterType: "insulinSensitivityFactor", changeKind: "VALUE", currentValue: 0.5, proposedValue: 0.48, isfUnit: "gl" },
    glycemia: { glucosesGl: Array(100).fill(1.2), hypoGlucosesGl: Array(100).fill(1.2), capturePercent: 80, windowDays: 14, recentKetonesMmol: [], ketoneModerateThreshold: 1.5 },
    ratchet: { hoursSinceLastAutoApply: null, cumulativeAbsPercentThisWeek: 0 },
    ...over,
  }
}
const merge = (over: Partial<EnvelopeInput>, sub?: Partial<EnvelopeInput["change"]>): EnvelopeInput => {
  const b = base(over)
  return sub ? { ...b, change: { ...b.change, ...sub } } : b
}

describe("evaluateAutoApplyEnvelope", () => {
  it("toutes conditions franchies → AUTO_APPLY", () => {
    expect(evaluateAutoApplyEnvelope(base())).toEqual({ decision: "AUTO_APPLY" })
  })

  it("C1 : niveau non expert → proposition", () => {
    expect(evaluateAutoApplyEnvelope(base({ authority: { maturityLevel: "INTERMEDIATE", autoApply: true } })))
      .toEqual({ decision: "FALLBACK_PROPOSAL", failedCheck: "C1" })
  })
  it("C1 : flag autoApply OFF → proposition", () => {
    expect(evaluateAutoApplyEnvelope(base({ authority: { maturityLevel: "EXPERT", autoApply: false } })))
      .toEqual({ decision: "FALLBACK_PROPOSAL", failedCheck: "C1" })
  })

  it("C2 : changement structurel → proposition (jamais auto-appliqué)", () => {
    expect(evaluateAutoApplyEnvelope(merge({}, { changeKind: "STRUCTURAL" })))
      .toEqual({ decision: "FALLBACK_PROPOSAL", failedCheck: "C2" })
  })

  it("C3 : amplitude > 10 % → proposition", () => {
    expect(evaluateAutoApplyEnvelope(merge({}, { proposedValue: 0.4 }))) // -20 %
      .toEqual({ decision: "FALLBACK_PROPOSAL", failedCheck: "C3" })
  })

  it("C4 : valeur hors bornes cliniques → REJET DUR", () => {
    expect(evaluateAutoApplyEnvelope(merge({}, { proposedValue: 1.5 }))) // > ISF_GL_MAX 1,00
      .toEqual({ decision: "HARD_REJECT", reason: "outOfClinicalBounds" })
  })
  it("C4 précédence : hors bornes rejeté DUR même si C1 échouerait aussi", () => {
    expect(
      evaluateAutoApplyEnvelope(
        merge({ authority: { maturityLevel: "INTERMEDIATE", autoApply: false } }, { proposedValue: 1.5 }),
      ),
    ).toEqual({ decision: "HARD_REJECT", reason: "outOfClinicalBounds" })
  })

  it("C5 : débit basal non délivrable → proposition", () => {
    // basal 0,80 → 0,83 (hausse, +insuline) mais 0,83 non multiple de 0,05.
    const inp = merge({}, { parameterType: "basalRate", currentValue: 0.8, proposedValue: 0.83, isfUnit: undefined })
    expect(evaluateAutoApplyEnvelope(inp)).toEqual({ decision: "FALLBACK_PROPOSAL", failedCheck: "C5" })
  })

  it("C6 : HAUSSE d'insuline bloquée si hypo sévère récente (capillaire incluse) → proposition", () => {
    // La garde hypo lit `hypoGlucosesGl` (CGM ∪ capillaire) : une hypo sévère au doigt suffit.
    const inp = base({ glycemia: { glucosesGl: Array(100).fill(1.2), hypoGlucosesGl: [1.2, 0.5, 1.4], capturePercent: 80, windowDays: 14, recentKetonesMmol: [], ketoneModerateThreshold: 1.5 } })
    expect(evaluateAutoApplyEnvelope(inp)).toEqual({ decision: "FALLBACK_PROPOSAL", failedCheck: "C6" })
  })
  it("C6 : HAUSSE sans AUCUNE donnée récente (hypoGlucosesGl vide) → proposition (fail-closed, US-2657)", () => {
    const inp = base({ glycemia: { glucosesGl: [], hypoGlucosesGl: [], capturePercent: 0, windowDays: 14, recentKetonesMmol: [], ketoneModerateThreshold: 1.5 } })
    expect(evaluateAutoApplyEnvelope(inp)).toEqual({ decision: "FALLBACK_PROPOSAL", failedCheck: "C6" })
  })

  it("C6b : BAISSE d'insuline bloquée sur données insuffisantes (BGM/fenêtre courte) → proposition", () => {
    // ISF 0,50 → 0,52 (baisse d'insuline, direction hyper) + fenêtre 5 j.
    const inp = merge({ glycemia: { glucosesGl: Array(100).fill(1.2), hypoGlucosesGl: Array(100).fill(1.2), capturePercent: 80, windowDays: 5, recentKetonesMmol: [], ketoneModerateThreshold: 1.5 } }, { proposedValue: 0.52 })
    expect(evaluateAutoApplyEnvelope(inp)).toEqual({ decision: "FALLBACK_PROPOSAL", failedCheck: "C6b" })
  })
  it("C6b : BAISSE bloquée si hyper soutenue → proposition", () => {
    const g = [...Array(40).fill(2.0), ...Array(60).fill(1.2)] // TAR>180 = 40 % > 30 %
    const inp = merge({ glycemia: { glucosesGl: g, hypoGlucosesGl: g, capturePercent: 80, windowDays: 14, recentKetonesMmol: [], ketoneModerateThreshold: 1.5 } }, { proposedValue: 0.52 })
    expect(evaluateAutoApplyEnvelope(inp)).toEqual({ decision: "FALLBACK_PROPOSAL", failedCheck: "C6b" })
  })
  it("C6b pathology-aware : glycémies ~1,55 (cible DG 1,40) → hyper soutenue détectée → proposition", () => {
    // Seuils DG (ok=1,40, high=2,00) : des glycémies à 1,55 g/L constantes tombent dans la bande « elevated »
    // → TAR>cible = 100 % > 30 % → C6b. Avec les seuils adultes (ok=1,80) elles seraient « in range » (bug corrigé).
    const g = Array(100).fill(1.55)
    const gd = { veryLow: 0.6, low: 0.63, ok: 1.4, high: 2.0 }
    const inp = merge(
      { glycemia: { glucosesGl: g, hypoGlucosesGl: g, capturePercent: 80, windowDays: 14, recentKetonesMmol: [], ketoneModerateThreshold: 1.5, cgmThresholds: gd } },
      { proposedValue: 0.52 },
    )
    expect(evaluateAutoApplyEnvelope(inp)).toEqual({ decision: "FALLBACK_PROPOSAL", failedCheck: "C6b" })
  })
  it("C6b : BAISSE AUTORISÉE si bien contrôlé + fenêtre suffisante → AUTO_APPLY", () => {
    const inp = merge({}, { proposedValue: 0.52 }) // base = bien contrôlé, 14 j, capture 80
    expect(evaluateAutoApplyEnvelope(inp)).toEqual({ decision: "AUTO_APPLY" })
  })

  it("C7 : cooldown non écoulé → proposition", () => {
    expect(evaluateAutoApplyEnvelope(base({ ratchet: { hoursSinceLastAutoApply: 10, cumulativeAbsPercentThisWeek: 0 } })))
      .toEqual({ decision: "FALLBACK_PROPOSAL", failedCheck: "C7" })
  })
  it("C7 : cumul hebdomadaire dépassé → proposition", () => {
    // base Δ = 4 % ; cumul 12 % + 4 % = 16 % > 15 %.
    expect(evaluateAutoApplyEnvelope(base({ ratchet: { hoursSinceLastAutoApply: null, cumulativeAbsPercentThisWeek: 12 } })))
      .toEqual({ decision: "FALLBACK_PROPOSAL", failedCheck: "C7" })
  })

  it("C8 fail-closed : ISF sans unité → proposition", () => {
    expect(evaluateAutoApplyEnvelope(merge({}, { isfUnit: undefined })))
      .toEqual({ decision: "FALLBACK_PROPOSAL", failedCheck: "C8" })
  })
  it("C8 fail-closed : valeur courante nulle/NaN → proposition", () => {
    expect(evaluateAutoApplyEnvelope(merge({}, { currentValue: 0 })).decision).toBe("FALLBACK_PROPOSAL")
  })
  it("C8 fail-closed : cumul inconnu (null) → proposition", () => {
    expect(evaluateAutoApplyEnvelope(base({ ratchet: { hoursSinceLastAutoApply: null, cumulativeAbsPercentThisWeek: null } })))
      .toEqual({ decision: "FALLBACK_PROPOSAL", failedCheck: "C8" })
  })

  // Dose fixe (amplitude en U) + unité ISF mg/dL.
  it("dose fixe : Δ > 1 U → C3", () => {
    const inp = merge({}, { parameterType: "fixedDose", currentValue: 10, proposedValue: 12, isfUnit: undefined }) // +2 U
    expect(evaluateAutoApplyEnvelope(inp)).toEqual({ decision: "FALLBACK_PROPOSAL", failedCheck: "C3" })
  })
  it("dose fixe : valeur non délivrable (pas multiple de 0,5) → C5", () => {
    const inp = merge({}, { parameterType: "fixedDose", currentValue: 10, proposedValue: 10.3, isfUnit: undefined })
    expect(evaluateAutoApplyEnvelope(inp)).toEqual({ decision: "FALLBACK_PROPOSAL", failedCheck: "C5" })
  })
  it("dose fixe : Δ ≤ 1 U, délivrable, fenêtre saine → AUTO_APPLY", () => {
    const inp = merge({}, { parameterType: "fixedDose", currentValue: 10, proposedValue: 10.5, isfUnit: undefined }) // +0,5 U (hausse)
    expect(evaluateAutoApplyEnvelope(inp)).toEqual({ decision: "AUTO_APPLY" })
  })
  it("ISF mg/dL : valeur hors bornes mg/dL (> 100) → REJET DUR", () => {
    const inp = merge({}, { currentValue: 50, proposedValue: 150, isfUnit: "mgdl" })
    expect(evaluateAutoApplyEnvelope(inp)).toEqual({ decision: "HARD_REJECT", reason: "outOfClinicalBounds" })
  })
})
