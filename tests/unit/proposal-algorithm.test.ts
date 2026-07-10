/**
 * Test suite: Proposal Algorithm — Insulin Adjustment Proposal Generation
 *
 * Clinical behavior tested:
 * - Confidence level assignment based on the number of qualifying glucose
 *   events: 3–5 events = "low", 6–10 = "medium", >10 = "high"; proposals
 *   below "low" confidence are not generated (insufficient data)
 * - Change percent clamping: ISF, ICR AND basal adjustments are all capped at
 *   ±20% per proposal cycle (CLINICAL_BOUNDS.MAX_CHANGE_PERCENT) via the shared
 *   `clampChangePercent` — no per-parameter cap difference
 * - Proposed value computation: applies the clamped percentage change to the
 *   current value and rounds uniformly to 4 decimals (`computeProposedValue`)
 * - ISF slot analysis: compares post-meal correction outcomes within a time
 *   slot against the glucose target to infer whether the sensitivity factor
 *   should increase or decrease
 * - ICR slot analysis: evaluates post-prandial glucose rise relative to
 *   reported carb intake to assess whether the carb ratio is appropriate
 * - Basal trend analysis: detects fasting glucose drift across overnight and
 *   inter-meal windows to flag basal rate under- or over-delivery
 *
 * Associated risks:
 * - An unclamped adjustment could propose an ISF or ICR change exceeding safe
 *   clinical limits, leading to hypoglycemia or hyperglycemia if accepted
 * - Generating a "high confidence" proposal from only 3 events would produce
 *   an unreliable suggestion that a physician might accept without scrutiny
 * - A sign inversion bug in analyzeIsfSlot (proposing to raise ISF when it
 *   should decrease) would systematically under-correct hyperglycemia
 * - Precision errors in computeProposedValue could push a value outside
 *   CLINICAL_BOUNDS after rounding
 *
 * Edge cases:
 * - Exactly 3 events (minimum for "low" confidence)
 * - Exactly 11 events (minimum for "high" confidence)
 * - Change percent of 0% (no proposal should be emitted)
 * - Current value at CLINICAL_BOUNDS minimum with a proposed decrease (must
 *   clamp to minimum, not go below)
 * - Current value at CLINICAL_BOUNDS maximum with a proposed increase (must
 *   clamp to maximum)
 * - Empty events array passed to analyzeIsfSlot or analyzeIcrSlot
 */
import { describe, it, expect } from "vitest"
import {
  getConfidenceLevel, clampChangePercent, computeProposedValue,
  analyzeIsfSlot, analyzeIcrSlot, analyzeBasalTrend, analyzeFixedDose,
  recurrentPostMealHypo, analyzeIcrHypoDeescalation, hasSevereHypo,
  analyzeIsfHypoDeescalation, analyzeBasalHypoDeescalation, analyzeFixedDoseHypoDeescalation,
} from "@/lib/proposal-algorithm"

describe("proposal-algorithm", () => {
  describe("getConfidenceLevel", () => {
    it("returns low for 3-5 events", () => {
      expect(getConfidenceLevel(3)).toBe("low")
      expect(getConfidenceLevel(5)).toBe("low")
    })
    it("returns medium for 6-10 events", () => {
      expect(getConfidenceLevel(6)).toBe("medium")
      expect(getConfidenceLevel(10)).toBe("medium")
    })
    it("returns high for >10 events", () => {
      expect(getConfidenceLevel(11)).toBe("high")
    })
  })

  describe("clampChangePercent", () => {
    it("clamps to ±20%", () => {
      expect(clampChangePercent(25)).toBe(20)
      expect(clampChangePercent(-30)).toBe(-20)
      expect(clampChangePercent(10)).toBe(10)
    })
  })

  describe("computeProposedValue", () => {
    it("applies clamped percentage", () => {
      expect(computeProposedValue(0.50, 10)).toBeCloseTo(0.55)
      expect(computeProposedValue(10.0, -10)).toBeCloseTo(9.0)
    })
    it("caps at ±20%", () => {
      expect(computeProposedValue(1.0, 50)).toBeCloseTo(1.2) // clamped to +20%
    })
  })

  describe("analyzeIsfSlot", () => {
    const slot = { startHour: 8, endHour: 12, sensitivityFactorGl: 0.50 }

    it("returns null with < 3 events", () => {
      expect(analyzeIsfSlot(slot, [{ postGlucoseGl: 2.0, targetGl: 1.2 }])).toBeNull()
    })

    it("proposes adjustment when post-correction glucose above target (ISF too high)", () => {
      const corrections = Array.from({ length: 8 }, () => ({
        postGlucoseGl: 1.80, targetGl: 1.20,
      }))
      const result = analyzeIsfSlot(slot, corrections)
      expect(result).not.toBeNull()
      expect(result!.reason).toBe("isfTooHigh")
      expect(result!.confidence).toBe("medium")
      expect(Math.abs(result!.changePercent)).toBeGreaterThan(0)
    })

    it("proposes adjustment when post-correction glucose below target (ISF too low)", () => {
      const corrections = Array.from({ length: 5 }, () => ({
        postGlucoseGl: 0.60, targetGl: 1.20,
      }))
      const result = analyzeIsfSlot(slot, corrections)
      expect(result).not.toBeNull()
      expect(result!.reason).toBe("isfTooLow")
    })

    it("returns null when error < 2%", () => {
      const corrections = Array.from({ length: 5 }, () => ({
        postGlucoseGl: 1.21, targetGl: 1.20,
      }))
      expect(analyzeIsfSlot(slot, corrections)).toBeNull()
    })

    it("garde HYPO : baisse ISF supprimée si un post-correction est en hypo sévère (US-2651)", () => {
      const corrections = [
        ...Array.from({ length: 5 }, () => ({ postGlucoseGl: 1.80, targetGl: 1.20 })),
        { postGlucoseGl: 0.40, targetGl: 1.20 }, // hypo sévère < 0,54 g/L
      ]
      // Moyenne haute → isfTooHigh (baisser l'ISF = corrections plus fortes = plus d'insuline) → supprimé.
      expect(analyzeIsfSlot(slot, corrections)).toBeNull()
    })

    it("garde HYPO : hausse ISF (sens sûr, moins d'insuline) permise malgré des hypos", () => {
      const corrections = Array.from({ length: 5 }, () => ({ postGlucoseGl: 0.40, targetGl: 1.20 }))
      const r = analyzeIsfSlot(slot, corrections) // sur-correction → isfTooLow (hausse ISF)
      expect(r!.reason).toBe("isfTooLow")
    })

    it("garde HYPO : UN seul relevé niveau-1 (0,54) ne supprime pas la baisse ISF (borne)", () => {
      const corrections = [
        ...Array.from({ length: 5 }, () => ({ postGlucoseGl: 1.80, targetGl: 1.20 })),
        { postGlucoseGl: 0.54, targetGl: 1.20 }, // niveau 1, non sévère, isolé
      ]
      const r = analyzeIsfSlot(slot, corrections)
      expect(r!.reason).toBe("isfTooHigh") // non supprimé
    })

    it("garde HYPO : DEUX relevés niveau-1 (< 0,70) récurrents suppriment la baisse ISF", () => {
      const corrections = [
        ...Array.from({ length: 4 }, () => ({ postGlucoseGl: 1.80, targetGl: 1.20 })),
        { postGlucoseGl: 0.60, targetGl: 1.20 },
        { postGlucoseGl: 0.65, targetGl: 1.20 },
      ]
      expect(analyzeIsfSlot(slot, corrections)).toBeNull()
    })

    it("garde HYPO : le NADIR post-correction supprime une baisse que le post-correction seul laisserait passer", () => {
      // Post-corrections toutes HAUTES (correction trop faible → isfTooHigh, baisse) MAIS un creux tardif sévère.
      const corrections = Array.from({ length: 4 }, () => ({ postGlucoseGl: 1.80, targetGl: 1.20, nadirGl: 0.50 }))
      expect(analyzeIsfSlot(slot, corrections)).toBeNull() // baisse supprimée par le nadir
    })

    it("garde HYPO : SANS nadir, les mêmes post-corrections hautes proposent la baisse (contrôle)", () => {
      const corrections = Array.from({ length: 4 }, () => ({ postGlucoseGl: 1.80, targetGl: 1.20 }))
      expect(analyzeIsfSlot(slot, corrections)!.reason).toBe("isfTooHigh")
    })

    it("le nadir ne corrompt PAS la moyenne/direction (% identique avec et sans nadir)", () => {
      const base = Array.from({ length: 5 }, () => ({ postGlucoseGl: 0.60, targetGl: 1.20 })) // sur-correction → isfTooLow (sens sûr)
      const r1 = analyzeIsfSlot(slot, base)
      const r2 = analyzeIsfSlot(slot, base.map((c) => ({ ...c, nadirGl: 0.50 })))
      expect(r1!.reason).toBe("isfTooLow")
      expect(r2!.reason).toBe("isfTooLow")
      expect(r2!.changePercent).toBe(r1!.changePercent)
    })
  })

  describe("analyzeIcrSlot", () => {
    const slot = { startHour: 12, endHour: 14, gramsPerUnit: 10 }

    it("post-repas au-dessus de la cible → ICR trop haut → baisse (reason icrTooHigh)", () => {
      const meals = Array.from({ length: 6 }, () => ({
        postGlucoseGl: 2.00, targetGl: 1.20,
      }))
      const result = analyzeIcrSlot(slot, meals)
      expect(result).not.toBeNull()
      expect(result!.parameterType).toBe("insulinToCarbRatio")
      // Direction : baisse de l'ICR (plus d'insuline/gramme).
      expect(result!.proposedValue).toBeLessThan(slot.gramsPerUnit)
      // Libellé corrigé (US-2651, validé medical) : l'ICR courant est trop HAUT.
      expect(result!.reason).toBe("icrTooHigh")
    })

    it("post-repas en dessous de la cible → ICR trop bas → hausse (reason icrTooLow)", () => {
      const meals = Array.from({ length: 6 }, () => ({ postGlucoseGl: 0.80, targetGl: 1.20 }))
      const result = analyzeIcrSlot(slot, meals)
      expect(result!.proposedValue).toBeGreaterThan(slot.gramsPerUnit)
      expect(result!.reason).toBe("icrTooLow")
    })

    it("returns null with insufficient data", () => {
      expect(analyzeIcrSlot(slot, [])).toBeNull()
    })

    it("garde HYPO : baisse ICR supprimée si un post-repas est en hypo sévère (US-2651)", () => {
      const meals = [
        ...Array.from({ length: 5 }, () => ({ postGlucoseGl: 2.00, targetGl: 1.20 })),
        { postGlucoseGl: 0.40, targetGl: 1.20 },
      ]
      // Moyenne haute → icrTooHigh (baisser l'ICR = plus d'insuline/gramme) → supprimé par la garde hypo.
      expect(analyzeIcrSlot(slot, meals)).toBeNull()
    })

    it("garde HYPO : hausse ICR (sens sûr, moins d'insuline) permise malgré des hypos", () => {
      const meals = Array.from({ length: 5 }, () => ({ postGlucoseGl: 0.40, targetGl: 1.20 }))
      const r = analyzeIcrSlot(slot, meals) // moyenne basse → icrTooLow (hausse ICR)
      expect(r!.reason).toBe("icrTooLow")
    })

    it("garde HYPO : le NADIR supprime une baisse que la PPG 2 h seule laisserait passer (US-2651)", () => {
      const meals = [
        ...Array.from({ length: 5 }, () => ({ postGlucoseGl: 1.80, targetGl: 1.40 })),
        { postGlucoseGl: 1.70, targetGl: 1.40, nadirGl: 0.50 }, // PPG 2 h saine, mais nadir 3-4 h en hypo sévère
      ]
      // avgPost ≈ 1,78 > cible → baisse (icrTooHigh) ; le nadir 0,50 déclenche la garde → supprimé.
      expect(analyzeIcrSlot(slot, meals)).toBeNull()
    })

    it("garde HYPO : SANS nadir, la même fenêtre (PPG 2 h saines) n'est PAS supprimée (contrôle)", () => {
      const meals = [
        ...Array.from({ length: 5 }, () => ({ postGlucoseGl: 1.80, targetGl: 1.40 })),
        { postGlucoseGl: 1.70, targetGl: 1.40 }, // pas de nadir → repli sur PPG 2 h (1,70, saine)
      ]
      expect(analyzeIcrSlot(slot, meals)!.reason).toBe("icrTooHigh")
    })

    it("le nadir ne corrompt PAS la moyenne/direction (% identique avec et sans nadir)", () => {
      const base = Array.from({ length: 5 }, () => ({ postGlucoseGl: 0.80, targetGl: 1.40 }))
      const withNadir = base.map((m) => ({ ...m, nadirGl: 0.60 }))
      const r1 = analyzeIcrSlot(slot, base)
      const r2 = analyzeIcrSlot(slot, withNadir)
      // sens sûr (hausse icrTooLow) dans les deux cas ; le nadir n'affecte ni la direction ni le %.
      expect(r1!.reason).toBe("icrTooLow")
      expect(r2!.reason).toBe("icrTooLow")
      expect(r2!.changePercent).toBe(r1!.changePercent)
    })
  })

  describe("recurrentPostMealHypo (US-2653)", () => {
    it("< 3 nadirs → false (échantillon insuffisant)", () => {
      expect(recurrentPostMealHypo([0.5, 0.6])).toBe(false)
    })
    it("≥ 2 nadirs niveau-1 (< 0,70) → true (récurrent)", () => {
      expect(recurrentPostMealHypo([0.6, 0.65, 1.2])).toBe(true)
    })
    it("1 seul nadir niveau-1 → false (non récurrent)", () => {
      expect(recurrentPostMealHypo([0.65, 1.2, 1.3])).toBe(false)
    })
    it("1 sévère ISOLÉ (< 0,54) → false (garde anti-artefact : corroboration exigée)", () => {
      expect(recurrentPostMealHypo([0.5, 1.2, 1.3])).toBe(false)
    })
    it("1 sévère + 1 niveau-1 → true (le sévère compte comme niveau-1 → 2)", () => {
      expect(recurrentPostMealHypo([0.5, 0.65, 1.2])).toBe(true)
    })
    it("borne exacte 0,70 exclue (< strict) → non compté niveau-1", () => {
      expect(recurrentPostMealHypo([0.7, 0.7, 1.2])).toBe(false)
    })
    it("garde anti-null : un null ne fabrique PAS une hypo (Number.isFinite)", () => {
      expect(recurrentPostMealHypo([null as unknown as number, null as unknown as number, 1.2])).toBe(false)
    })
    it("récurrence = compte ABSOLU (≥ 2), pas une proportion : 2 creux dans une grande fenêtre → true", () => {
      expect(recurrentPostMealHypo([0.6, 0.65, 1.2, 1.3, 1.4, 1.5, 1.6])).toBe(true)
    })
  })

  describe("analyzeIcrHypoDeescalation (US-2653)", () => {
    const slot = { startHour: 12, endHour: 14, gramsPerUnit: 10 }
    it("hypo récurrente → HAUSSE ICR +10 % (moins d'insuline), icrTooLow", () => {
      const r = analyzeIcrHypoDeescalation(slot, [0.6, 0.65, 1.2])
      expect(r).not.toBeNull()
      expect(r!.reason).toBe("icrTooLow")
      expect(r!.changePercent).toBe(10)
      expect(r!.proposedValue).toBe(11) // 10 × 1,10
      expect(r!.proposedValue).toBeGreaterThan(slot.gramsPerUnit)
      expect(r!.supportingEvents).toBe(2) // 2 nadirs en hypo
    })
    it("hypo non récurrente → null", () => {
      expect(analyzeIcrHypoDeescalation(slot, [0.65, 1.2, 1.3])).toBeNull()
    })
  })

  describe("hasSevereHypo (US-2653)", () => {
    it("un relevé < 0,54 g/L (niveau 2) → true", () => {
      expect(hasSevereHypo([1.2, 0.5, 1.4])).toBe(true)
    })
    it("aucun relevé sévère (même si niveau 1) → false", () => {
      expect(hasSevereHypo([0.6, 0.65, 1.2])).toBe(false)
    })
    it("fenêtre vide → false ; null ignoré", () => {
      expect(hasSevereHypo([])).toBe(false)
      expect(hasSevereHypo([null as unknown as number, 1.2])).toBe(false)
    })
  })

  describe("analyzeIsfHypoDeescalation (US-2653)", () => {
    const slot = { startHour: 8, endHour: 12, sensitivityFactorGl: 0.5 }
    it("nadirs post-correction récurrents → HAUSSE ISF +10 % (corrections plus faibles), isfTooLow", () => {
      const r = analyzeIsfHypoDeescalation(slot, [0.6, 0.65, 1.2])
      expect(r).not.toBeNull()
      expect(r!.reason).toBe("isfTooLow")
      expect(r!.changePercent).toBe(10)
      expect(r!.proposedValue).toBe(0.55) // 0,50 × 1,10
      expect(r!.proposedValue).toBeGreaterThan(slot.sensitivityFactorGl)
      expect(r!.timeSlotStartHour).toBe(8)
      expect(r!.supportingEvents).toBe(2)
    })
    it("hypo non récurrente → null", () => {
      expect(analyzeIsfHypoDeescalation(slot, [0.65, 1.2, 1.3])).toBeNull()
    })
  })

  describe("analyzeBasalHypoDeescalation (US-2653)", () => {
    it("nadirs nocturnes récurrents → BAISSE basale −10 % snappée, basalTooHigh", () => {
      const r = analyzeBasalHypoDeescalation(1.0, [0.6, 0.65, 1.2])
      expect(r.kind).toBe("proposal")
      if (r.kind !== "proposal") throw new Error("expected proposal")
      expect(r.candidate.reason).toBe("basalTooHigh")
      expect(r.candidate.proposedValue).toBe(0.9) // 1,0 × 0,90, multiple de 0,05
      expect(r.candidate.proposedValue).toBeLessThan(1.0)
    })
    it("débit trop bas pour titrer d'un incrément après snap → flagNonActionable (pas de skip silencieux)", () => {
      // 0,10 × 0,90 = 0,09 → snap 0,10 = inchangé → non actionnable.
      expect(analyzeBasalHypoDeescalation(0.1, [0.6, 0.65, 1.2]).kind).toBe("flagNonActionable")
    })
    it("hypo nocturne non récurrente → none", () => {
      expect(analyzeBasalHypoDeescalation(1.0, [0.65, 1.2, 1.3]).kind).toBe("none")
    })
  })

  describe("analyzeFixedDoseHypoDeescalation (US-2653)", () => {
    const slot = { moment: "morning" as const, valueU: 10 }
    it("relevés du moment récurremment bas → BAISSE dose bornée, fixedDoseTooHigh", () => {
      const r = analyzeFixedDoseHypoDeescalation(slot, [0.6, 0.65, 1.2])
      expect(r.kind).toBe("proposal")
      if (r.kind !== "proposal") throw new Error("expected proposal")
      expect(r.candidate.reason).toBe("fixedDoseTooHigh")
      expect(r.candidate.proposedValue).toBe(9) // 10 − min(1U, 2U) = 9, snap 0,5
      expect(r.candidate.proposedValue).toBeLessThan(10)
    })
    it("dose au plancher (0,5 U) → flagNonActionable (baisse impossible)", () => {
      expect(analyzeFixedDoseHypoDeescalation({ moment: "night", valueU: 0.5 }, [0.5, 0.5, 0.6]).kind).toBe("flagNonActionable")
    })
    it("dose sous le plancher clinique → none (base de titration invalide)", () => {
      expect(analyzeFixedDoseHypoDeescalation({ moment: "noon", valueU: 0.3 }, [0.5, 0.5, 0.6]).kind).toBe("none")
    })
    it("hypo non récurrente → none", () => {
      expect(analyzeFixedDoseHypoDeescalation(slot, [0.65, 1.2, 1.3]).kind).toBe("none")
    })
    it("seuil d'actionnabilité : toute dose < 3,0 U (≤ 2,5 U testées) snappe à l'inchangé → flagNonActionable ; 3,0 U → proposal 2,5", () => {
      const rec = [0.6, 0.6, 1.2]
      for (const v of [1.0, 1.5, 2.0, 2.5]) {
        expect(analyzeFixedDoseHypoDeescalation({ moment: "morning", valueU: v }, rec).kind).toBe("flagNonActionable")
      }
      const r = analyzeFixedDoseHypoDeescalation({ moment: "morning", valueU: 3.0 }, rec)
      expect(r.kind).toBe("proposal")
      if (r.kind === "proposal") expect(r.candidate.proposedValue).toBe(2.5)
    })
  })

  describe("analyzeBasalHypoDeescalation — bornes de snap (US-2653)", () => {
    const rec = [0.6, 0.6, 1.2]
    it("0,25 U/h : −10 % snappe à l'inchangé → flagNonActionable", () => {
      expect(analyzeBasalHypoDeescalation(0.25, rec).kind).toBe("flagNonActionable")
    })
    it("0,30 U/h : baisse d'exactement un incrément → proposal 0,25", () => {
      const r = analyzeBasalHypoDeescalation(0.3, rec)
      expect(r.kind).toBe("proposal")
      if (r.kind === "proposal") expect(r.candidate.proposedValue).toBe(0.25)
    })
    it("jamais de HAUSSE via une dé-escalade (snap-up borné) : 0,55 → 0,50 (baisse), jamais > courant", () => {
      const r = analyzeBasalHypoDeescalation(0.55, rec)
      if (r.kind === "proposal") expect(r.candidate.proposedValue).toBeLessThan(0.55)
    })
  })

  describe("analyzeBasalTrend", () => {
    it("detects fasting glucose above target (basal too low)", () => {
      const fasting = [1.50, 1.60, 1.55, 1.45, 1.58]
      const result = analyzeBasalTrend(fasting, 1.20, 0.80)
      expect(result).not.toBeNull()
      expect(result!.reason).toBe("basalTooLow")
      expect(result!.parameterType).toBe("basalRate")
    })

    it("detects fasting glucose below target (basal too high)", () => {
      const fasting = [0.60, 0.55, 0.58, 0.62]
      const result = analyzeBasalTrend(fasting, 1.20, 0.80)
      expect(result).not.toBeNull()
      expect(result!.reason).toBe("basalTooHigh")
    })

    it("returns null with < 3 values", () => {
      expect(analyzeBasalTrend([1.5], 1.2, 0.8)).toBeNull()
    })

    it("garde HYPO : hausse basale supprimée si une glycémie à jeun est en hypo sévère (US-2651)", () => {
      // Moyenne élevée (dawn phenomenon) mais une hypo nocturne masquée → hausse basale supprimée.
      const fasting = [1.60, 1.55, 1.58, 0.40]
      expect(analyzeBasalTrend(fasting, 1.20, 0.80)).toBeNull()
    })

    it("garde HYPO : baisse basale (sens sûr, moins d'insuline) permise malgré des hypos", () => {
      const fasting = [0.50, 0.55, 0.48, 0.52] // moyenne basse → basalTooHigh (baisse)
      const r = analyzeBasalTrend(fasting, 1.20, 0.80)
      expect(r!.reason).toBe("basalTooHigh")
    })

    it("garde HYPO : le NADIR nocturne supprime une hausse que le à-jeun seul laisserait passer (Somogyi)", () => {
      const fasting = [1.50, 1.55, 1.60] // à jeun HAUT → basalTooLow (hausse) ; effet Somogyi
      const nadirs = [0.50, 1.30, 1.40] // MAIS un creux nocturne sévère (0,50)
      expect(analyzeBasalTrend(fasting, 1.20, 0.80, nadirs)).toBeNull() // hausse supprimée
    })

    it("garde HYPO : SANS nadir nocturne, le même à-jeun haut propose la hausse (contrôle)", () => {
      const fasting = [1.50, 1.55, 1.60]
      expect(analyzeBasalTrend(fasting, 1.20, 0.80)!.reason).toBe("basalTooLow")
    })

    it("le nadir ne corrompt PAS la moyenne/direction (% identique avec et sans nadir)", () => {
      const fasting = [0.70, 0.72, 0.71] // basalTooHigh (baisse, sens sûr)
      const r1 = analyzeBasalTrend(fasting, 1.20, 0.80)
      const r2 = analyzeBasalTrend(fasting, 1.20, 0.80, [0.60, 0.62, 0.61])
      expect(r1!.reason).toBe("basalTooHigh")
      expect(r2!.reason).toBe("basalTooHigh")
      expect(r2!.changePercent).toBe(r1!.changePercent)
    })

    it("snapping délivrable : proposedValue = multiple de 0,05 U/h (US-2651, sinon rejeté à la persistance)", () => {
      // 0,50 × 1,07 = 0,535 (non délivrable) → snap au multiple de 0,05 le plus proche = 0,55.
      const r = analyzeBasalTrend([1.07, 1.07, 1.07], 1.0, 0.5)
      expect(r!.reason).toBe("basalTooLow")
      expect(r!.proposedValue).toBeCloseTo(0.55) // pas 0,535
      expect(Math.round(r!.proposedValue / 0.05)).toBeCloseTo(r!.proposedValue / 0.05) // multiple exact
    })

    it("snapping : variation qui s'arrondit à zéro (< 1 incrément) → null (non actionnable)", () => {
      // 0,05 × 1,03 = 0,0515 → snap = 0,05 → delta nul → aucune proposition.
      expect(analyzeBasalTrend([1.03, 1.03, 1.03], 1.0, 0.05)).toBeNull()
    })
  })

  describe("analyzeFixedDose (mode b, US-2651)", () => {
    const slot = { moment: "noon" as const, valueU: 20 }
    const readings = (post: number, n = 6) =>
      Array.from({ length: n }, () => ({ postGlucoseGl: post, targetGl: 1.2 }))

    it("insuffisant (< 3 relevés) → null", () => {
      expect(analyzeFixedDose(slot, readings(2.0, 2))).toBeNull()
    })

    it("glycémie au-dessus de la cible → dose trop basse → HAUSSE bornée (reason fixedDoseTooLow)", () => {
      const r = analyzeFixedDose(slot, readings(2.0))
      expect(r).not.toBeNull()
      expect(r!.parameterType).toBe("fixedDose")
      expect(r!.reason).toBe("fixedDoseTooLow")
      // Cap = min(±10 % de 20 = 2 U, ±2 U) → +2 U.
      expect(r!.proposedValue).toBe(22)
      expect(r!.changePercent).toBe(10) // +2 U / 20 U = 10 %
    })

    it("glycémie en dessous de la cible → dose trop haute → BAISSE (reason fixedDoseTooHigh)", () => {
      const r = analyzeFixedDose(slot, readings(1.0))
      expect(r!.reason).toBe("fixedDoseTooHigh")
      expect(r!.proposedValue).toBe(18)
    })

    it("cap ABSOLU ± 2 U l'emporte sur ± 10 % pour une grosse dose (50 U → +2 U, pas +5 U)", () => {
      const r = analyzeFixedDose({ moment: "morning", valueU: 50 }, readings(2.0))
      expect(r!.proposedValue).toBe(52)
    })

    it("pas arrondi nul (< 0,5 U) → non actionnable → null", () => {
      // 4 U, PPG à peine au-dessus (1.25 vs 1.2) → delta ≈ 0,17 U → arrondi 0 → null.
      expect(analyzeFixedDose({ moment: "evening", valueU: 4 }, readings(1.25))).toBeNull()
    })

    it("garde HYPO : une hypo sévère dans le moment supprime toute HAUSSE → null (US-2651)", () => {
      const mixed = [
        { postGlucoseGl: 2.5, targetGl: 1.2 },
        { postGlucoseGl: 2.6, targetGl: 1.2 },
        { postGlucoseGl: 2.4, targetGl: 1.2 },
        { postGlucoseGl: 0.4, targetGl: 1.2 }, // hypo sévère < 0,54 g/L
      ]
      expect(analyzeFixedDose(slot, mixed)).toBeNull()
    })

    it("garde HYPO : la BAISSE reste permise malgré une hypo (sens sûr)", () => {
      const lowWithHypo = [
        { postGlucoseGl: 0.9, targetGl: 1.2 },
        { postGlucoseGl: 0.8, targetGl: 1.2 },
        { postGlucoseGl: 0.4, targetGl: 1.2 },
      ]
      const r = analyzeFixedDose(slot, lowWithHypo)
      expect(r!.reason).toBe("fixedDoseTooHigh")
      expect(r!.proposedValue).toBeLessThan(slot.valueU)
    })

    it("garde ENTRÉE : dose courante nulle ou < plancher → null (pas de division par zéro)", () => {
      expect(analyzeFixedDose({ moment: "noon", valueU: 0 }, readings(2.0))).toBeNull()
      expect(analyzeFixedDose({ moment: "noon", valueU: 0.2 }, readings(2.0))).toBeNull()
    })
  })

})
