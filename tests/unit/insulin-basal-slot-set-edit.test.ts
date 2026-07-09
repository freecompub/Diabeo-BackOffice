/**
 * US-2657 (grouped-only, ADR #23) — Logique pure de la fenêtre d'édition de GROUPE basale
 * (créneaux pompe, temps `"HH:MM"` minute-précis).
 *
 * Comportement clinique testé : la cohérence 24 h minute-précise (trou/chevauchement, alignée
 * sur `assertValidPumpSlotSet` serveur) qui conditionne « Valider », les fenêtres nommées, les
 * lignes en conflit, les bornes de débit **ET** la délivrabilité pompe (multiple de l'incrément
 * `PUMP_BASAL_INCREMENT`), le corps du `PUT` groupé, et le mapping des codes d'erreur propres
 * à la voie basale (`rateNotDeliverable`, `basalConfigNotFound`, `slotsBusy`).
 */
import { describe, it, expect } from "vitest"
import {
  describeBasalCoverage,
  validateBasalRows,
  canSubmitBasal,
  buildReplaceBasalRequest,
  mapSlotSetOutcome,
  parseHHMM,
  type BasalSlotRow,
} from "@/components/diabeo/patient/insulin-slot-set-edit"

const row = (key: string, startTime: string, endTime: string, value = "0.8"): BasalSlotRow => ({
  key,
  startTime,
  endTime,
  value,
})

const BASAL_BOUNDS = { min: 0.05, max: 5.0 }

describe("parseHHMM", () => {
  it("parse HH:MM valide en minutes", () => {
    expect(parseHHMM("00:00")).toBe(0)
    expect(parseHHMM("06:30")).toBe(390)
    expect(parseHHMM("23:59")).toBe(1439)
  })
  it("rejette un format illisible", () => {
    expect(parseHHMM("")).toBeNull()
    expect(parseHHMM("24:00")).toBeNull()
    expect(parseHHMM("6:30")).toBeNull()
    expect(parseHHMM("abc")).toBeNull()
  })
})

describe("describeBasalCoverage", () => {
  it("profil complet enjambant minuit → cohérent (aucun trou/chevauchement)", () => {
    const rep = describeBasalCoverage([row("a", "06:00", "22:00"), row("b", "22:00", "06:00")])
    expect(rep.hasGap).toBe(false)
    expect(rep.hasOverlap).toBe(false)
    expect(rep.gaps).toEqual([])
    expect(rep.conflictKeys.size).toBe(0)
  })

  it("trou minute-précis nommé + les DEUX lignes bordantes surlignées", () => {
    // [00:00,08:00) + [12:15,00:00) laisse 08:00–12:15 non couvert.
    const rep = describeBasalCoverage([row("a", "00:00", "08:00"), row("b", "12:15", "00:00")])
    expect(rep.hasGap).toBe(true)
    expect(rep.gaps).toEqual([{ startTime: "08:00", endTime: "12:15" }])
    expect(rep.conflictKeys.has("a")).toBe(true)
    expect(rep.conflictKeys.has("b")).toBe(true)
  })

  it("chevauchement minute-précis nommé + les lignes en conflit", () => {
    const rep = describeBasalCoverage([row("a", "06:00", "14:00"), row("b", "13:30", "22:00"), row("c", "22:00", "06:00")])
    expect(rep.hasOverlap).toBe(true)
    expect(rep.overlaps).toEqual([{ startTime: "13:30", endTime: "14:00" }])
    expect(rep.conflictKeys.has("a")).toBe(true)
    expect(rep.conflictKeys.has("b")).toBe(true)
    expect(rep.conflictKeys.has("c")).toBe(false)
  })

  it("cover[] : 48 cases (résolution 30 min, décoratif)", () => {
    const rep = describeBasalCoverage([row("a", "00:00", "00:00")]) // durée nulle → dégénéré, ignoré
    expect(rep.cover).toHaveLength(48)
  })

  it("lignes de temps illisible exclues du calcul (signalées par validateBasalRows, pas comme un trou)", () => {
    const rep = describeBasalCoverage([row("a", "bad", "06:00"), row("b", "06:00", "00:00")])
    // Seule 'b' est prise en compte → couvre 06:00–00:00 (enjambe minuit) → trou 00:00–06:00.
    expect(rep.hasGap).toBe(true)
    expect(rep.conflictKeys.has("a")).toBe(false)
  })
})

describe("validateBasalRows", () => {
  it("détecte durée nulle, débit hors bornes, débit non délivrable, temps illisible, jeu vide", () => {
    const v = validateBasalRows(
      [
        row("a", "08:00", "08:00"), // durée nulle
        row("b", "08:00", "20:00", "6.0"), // > BASAL_MAX (5.0)
        row("c", "20:00", "08:00", "0.42"), // pas un multiple de 0.05 → non délivrable
        row("d", "bad", "06:00", "0.5"), // temps illisible
      ],
      BASAL_BOUNDS,
    )
    expect(v.zeroDurationKeys.has("a")).toBe(true)
    expect(v.invalidValueKeys.has("b")).toBe(true)
    expect(v.invalidValueKeys.has("c")).toBe(true)
    expect(v.invalidTimeKeys.has("d")).toBe(true)
    expect(v.isEmpty).toBe(false)
    expect(validateBasalRows([], BASAL_BOUNDS).isEmpty).toBe(true)
  })

  it("débit valide ET délivrable (multiple de 0.05) → aucune erreur", () => {
    const v = validateBasalRows([row("a", "06:00", "22:00", "0.85")], BASAL_BOUNDS)
    expect(v.invalidValueKeys.size).toBe(0)
  })
})

describe("canSubmitBasal", () => {
  const valid: BasalSlotRow[] = [row("a", "06:00", "22:00", "0.4"), row("b", "22:00", "06:00", "0.6")]

  it("cohérent + valide + modifié → true", () => {
    expect(canSubmitBasal(valid, BASAL_BOUNDS, true)).toBe(true)
  })
  it("non modifié → false", () => {
    expect(canSubmitBasal(valid, BASAL_BOUNDS, false)).toBe(false)
  })
  it("trou → false", () => {
    expect(canSubmitBasal([row("a", "06:00", "22:00", "0.4")], BASAL_BOUNDS, true)).toBe(false)
  })
  it("débit non délivrable → false", () => {
    expect(
      canSubmitBasal([row("a", "06:00", "22:00", "0.42"), row("b", "22:00", "06:00", "0.6")], BASAL_BOUNDS, true),
    ).toBe(false)
  })
})

describe("buildReplaceBasalRequest", () => {
  it("endpoint pump-slots + slots {startTime,endTime,rate}", () => {
    const { endpoint, body } = buildReplaceBasalRequest([row("a", "06:00", "22:00", "0,85")])
    expect(endpoint).toBe("/api/insulin-therapy/basal-config/pump-slots")
    expect(body.slots[0]).toEqual({ startTime: "06:00", endTime: "22:00", rate: 0.85 })
  })
})

describe("mapSlotSetOutcome — codes propres à la voie basale", () => {
  it("rateNotDeliverable / basalConfigNotFound / slotsBusy → clés dédiées", () => {
    expect(mapSlotSetOutcome(400, "rateNotDeliverable")).toEqual({
      kind: "error",
      messageKey: "slotSetErrorRateNotDeliverable",
    })
    expect(mapSlotSetOutcome(404, "basalConfigNotFound")).toEqual({ kind: "error", messageKey: "slotSetErrorNotFound" })
    expect(mapSlotSetOutcome(409, "slotsBusy")).toEqual({ kind: "error", messageKey: "slotSetErrorBusy" })
  })
})
