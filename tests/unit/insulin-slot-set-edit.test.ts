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

  it("trou nommé + les DEUX lignes bordantes surlignées", () => {
    // [0,8) + [12,0) laisse 8,9,10,11 non couverts (trou 8h–12h).
    const rep = describeCoverage([row("a", 0, 8), row("b", 12, 0)])
    expect(rep.hasGap).toBe(true)
    expect(rep.gaps).toEqual([{ startHour: 8, endHour: 12 }])
    // 'a' finit à endHour=8, heure 8 ∈ trou → borde à gauche.
    // 'b' commence à startHour=12, heure 11 (=startHour-1) ∈ trou → borde à droite.
    expect(rep.conflictKeys.has("a")).toBe(true)
    expect(rep.conflictKeys.has("b")).toBe(true)
  })

  it("nommage d'un trou enjambant minuit fusionné (pas scindé à 00h)", () => {
    // [1,20) couvre 1..19 → non couverts : 20,21,22,23,0 → fenêtre unique 20h–01h.
    const rep = describeCoverage([row("a", 1, 20)])
    expect(rep.hasGap).toBe(true)
    expect(rep.gaps).toEqual([{ startHour: 20, endHour: 1 }])
  })

  it("cover[] expose l'occupation horaire (0 trou, ≥2 chevauchement)", () => {
    const rep = describeCoverage([row("a", 0, 6), row("b", 4, 12)])
    expect(rep.cover).toHaveLength(24)
    expect(rep.cover[5]).toBe(2) // 4–6 couvert deux fois
    expect(rep.cover[0]).toBe(1)
    expect(rep.cover[15]).toBe(0) // non couvert
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
    expect(mapSlotSetOutcome(400, "zeroDurationSlot")).toEqual({ kind: "error", messageKey: "slotSetErrorZeroDuration" })
    expect(mapSlotSetOutcome(400, "valueOutOfBounds")).toEqual({ kind: "error", messageKey: "slotSetErrorBounds" })
    expect(mapSlotSetOutcome(409, "emptySlotSet")).toEqual({ kind: "error", messageKey: "slotSetErrorEmpty" })
    expect(mapSlotSetOutcome(403, "gdprConsentRequired")).toEqual({ kind: "error", messageKey: "slotSetErrorConsent" })
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
