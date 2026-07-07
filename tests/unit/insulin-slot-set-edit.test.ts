/**
 * US-2656 — Logique pure de la fenêtre d'édition de groupe.
 * Comportement clinique testé : la cohérence 24 h (trou/chevauchement) qui conditionne « Valider »,
 * les fenêtres nommées pour l'utilisateur, les lignes en conflit, les bornes de valeur.
 */
import { describe, it, expect } from "vitest"
import {
  describeCoverage,
  validateRows,
  canSubmit,
  buildReplaceRequest,
  mapSlotSetOutcome,
  parseSlotValue,
  type SlotRow,
} from "@/components/diabeo/patient/insulin-slot-set-edit"

const row = (key: string, startHour: number, endHour: number, value = "0.4", mealLabel?: string): SlotRow => ({
  key,
  startHour,
  endHour,
  value,
  mealLabel,
})

const ISF_BOUNDS = { min: 0.1, max: 1.0 }

describe("describeCoverage", () => {
  it("profil complet enjambant minuit → cohérent (aucun trou/chevauchement)", () => {
    const rep = describeCoverage([row("a", 6, 22), row("b", 22, 6)])
    expect(rep.hasGap).toBe(false)
    expect(rep.hasOverlap).toBe(false)
    expect(rep.gaps).toEqual([])
    expect(rep.conflictKeys.size).toBe(0)
  })

  it("trou nommé + lignes bordantes surlignées", () => {
    // [0,8) + [12,0) laisse 8–12 non couvert.
    const rep = describeCoverage([row("a", 0, 8), row("b", 12, 0)])
    expect(rep.hasGap).toBe(true)
    expect(rep.gaps).toEqual([{ startHour: 8, endHour: 12 }])
    // 'a' finit à 8 (heure 8 = trou → borde), 'b' commence à 12 (heure 11 avant... non ; 'b' commence à 12, heure avant=11 non-trou ;
    // mais heure endHour de 'a' = 8 ∈ trou → 'a' bordante ; 'b' : heure avant startHour = 11 non-trou, endHour=0 non-trou)
    expect(rep.conflictKeys.has("a")).toBe(true)
  })

  it("chevauchement nommé + les deux lignes en conflit", () => {
    const rep = describeCoverage([row("a", 6, 14), row("b", 12, 22), row("c", 22, 6)])
    expect(rep.hasOverlap).toBe(true)
    expect(rep.overlaps).toEqual([{ startHour: 12, endHour: 14 }])
    expect(rep.conflictKeys.has("a")).toBe(true)
    expect(rep.conflictKeys.has("b")).toBe(true)
    expect(rep.conflictKeys.has("c")).toBe(false)
  })
})

describe("validateRows", () => {
  it("détecte durée nulle, valeur hors bornes, jeu vide", () => {
    const v = validateRows([row("a", 8, 8), row("b", 8, 20, "1.5"), row("c", 20, 8, "0.4")], ISF_BOUNDS)
    expect(v.zeroDurationKeys.has("a")).toBe(true)
    expect(v.invalidValueKeys.has("b")).toBe(true) // 1.5 > max 1.0
    expect(v.invalidValueKeys.has("c")).toBe(false)
    expect(v.isEmpty).toBe(false)
    expect(validateRows([], ISF_BOUNDS).isEmpty).toBe(true)
  })
})

describe("canSubmit", () => {
  const valid: SlotRow[] = [row("a", 6, 22, "0.4"), row("b", 22, 6, "0.6")]

  it("cohérent + valide + modifié → true", () => {
    expect(canSubmit(valid, ISF_BOUNDS, true)).toBe(true)
  })
  it("non modifié → false", () => {
    expect(canSubmit(valid, ISF_BOUNDS, false)).toBe(false)
  })
  it("trou → false", () => {
    expect(canSubmit([row("a", 6, 22, "0.4")], ISF_BOUNDS, true)).toBe(false)
  })
  it("valeur hors bornes → false", () => {
    expect(canSubmit([row("a", 6, 22, "1.5"), row("b", 22, 6, "0.6")], ISF_BOUNDS, true)).toBe(false)
  })
})

describe("buildReplaceRequest", () => {
  it("ISF : endpoint + slots {startHour,endHour,sensitivityFactorGl}", () => {
    const { endpoint, body } = buildReplaceRequest("insulinSensitivityFactor", [row("a", 6, 22, "0,4")])
    expect(endpoint).toBe("/api/insulin-therapy/sensitivity-factors")
    expect(body.slots[0]).toEqual({ startHour: 6, endHour: 22, sensitivityFactorGl: 0.4 })
  })
  it("ICR : champ gramsPerUnit + mealLabel préservé", () => {
    const { endpoint, body } = buildReplaceRequest("insulinToCarbRatio", [row("a", 6, 12, "8", "PDJ")])
    expect(endpoint).toBe("/api/insulin-therapy/carb-ratios")
    expect(body.slots[0]).toEqual({ startHour: 6, endHour: 12, gramsPerUnit: 8, mealLabel: "PDJ" })
  })
})

describe("mapSlotSetOutcome", () => {
  it("200 → success", () => {
    expect(mapSlotSetOutcome(200, undefined)).toEqual({ kind: "success" })
  })
  it("codes serveur → clés de message", () => {
    expect(mapSlotSetOutcome(409, "slotOverlap")).toEqual({ kind: "error", messageKey: "slotSetErrorOverlap" })
    expect(mapSlotSetOutcome(422, "slotGap")).toEqual({ kind: "error", messageKey: "slotSetErrorGap" })
    expect(mapSlotSetOutcome(404, "patientNotFound")).toEqual({ kind: "error", messageKey: "slotSetErrorNotFound" })
    expect(mapSlotSetOutcome(500, "boom")).toEqual({ kind: "error", messageKey: "slotSetErrorGeneric" })
  })
})

describe("parseSlotValue", () => {
  it("virgule décimale + vide", () => {
    expect(parseSlotValue("0,45")).toBe(0.45)
    expect(parseSlotValue("")).toBeNull()
    expect(parseSlotValue("abc")).toBeNull()
  })
})
