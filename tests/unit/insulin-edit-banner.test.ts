/**
 * US-2648b — Logique d'affichage du bandeau d'édition insuline (helper pur).
 * Vérifie les AC UI de la revue clinique (message « corriger » conditionnel,
 * message honnête doses fixes, note non-insuliné).
 */
import { describe, it, expect } from "vitest"
import type { InsulinEditCapability } from "@/lib/insulin/edit-capability"
import { deriveBannerContent, MODE_LABEL_KEY } from "@/components/diabeo/patient/insulin-edit-banner"

const cap = (over: Partial<InsulinEditCapability>): InsulinEditCapability => ({
  mode: "basalBolus",
  coherent: true,
  canEditDirect: false,
  canPropose: true,
  canEditSlots: false,
  maturityLevel: "JUNIOR",
  canSetMaturity: false,
  editableParameters: [],
  ...over,
})

describe("deriveBannerContent", () => {
  it("basalBolus cohérent (éditable) → aucune note", () => {
    const c = deriveBannerContent(cap({ mode: "basalBolus", coherent: true, editableParameters: ["insulinSensitivityFactor"] }))
    expect(c).toEqual({ modeKey: MODE_LABEL_KEY.basalBolus, note: null, showRepairHint: false })
  })

  it("config incohérente + écriture directe (DOCTOR) → note + indice « corriger »", () => {
    const c = deriveBannerContent(cap({ blockedReason: "incoherentConfig", canEditDirect: true }))
    expect(c.note).toBe("incoherentConfig")
    expect(c.showRepairHint).toBe(true)
  })

  it("config incohérente SANS écriture directe (NURSE/patient) → note SANS indice", () => {
    const c = deriveBannerContent(cap({ blockedReason: "incoherentConfig", canEditDirect: false }))
    expect(c.note).toBe("incoherentConfig")
    expect(c.showRepairHint).toBe(false)
  })

  it("doses fixes → message de titration honnête", () => {
    const c = deriveBannerContent(cap({ mode: "fixedDose", blockedReason: "modeNotEditable" }))
    expect(c).toEqual({ modeKey: MODE_LABEL_KEY.fixedDose, note: "fixedDoseTitration", showRepairHint: false })
  })

  it("non-insuliné → note dédiée", () => {
    const c = deriveBannerContent(cap({ mode: "nonInsulin", blockedReason: "modeNotEditable" }))
    expect(c).toEqual({ modeKey: MODE_LABEL_KEY.nonInsulin, note: "nonInsulin", showRepairHint: false })
  })
})
