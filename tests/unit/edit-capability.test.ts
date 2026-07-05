/**
 * US-2648b — Capability descriptor d'édition insuline (fonction pure).
 *
 * Vérifie la matrice (rôle × mode) : qui peut écrire en direct / proposer, et quels
 * paramètres sont éditables selon le mode (fail-closed).
 */
import { describe, it, expect } from "vitest"
import type { Role } from "@prisma/client"
import { deriveEditCapability } from "@/lib/insulin/edit-capability"
import type { TreatmentModeResult } from "@/lib/services/treatment-mode.service"

const basalBolusOk: TreatmentModeResult = { mode: "basalBolus", coherent: true }
const basalBolusKo: TreatmentModeResult = { mode: "basalBolus", coherent: false }
const fixed: TreatmentModeResult = { mode: "fixedDose", coherent: true }
const none: TreatmentModeResult = { mode: "nonInsulin", coherent: true }

describe("deriveEditCapability — capacités par rôle", () => {
  it("DOCTOR : écriture directe ET proposition", () => {
    const c = deriveEditCapability("DOCTOR" as Role, basalBolusOk)
    expect(c.canEditDirect).toBe(true)
    expect(c.canPropose).toBe(true)
  })

  it("NURSE : proposition seulement (pas d'écriture directe)", () => {
    const c = deriveEditCapability("NURSE" as Role, basalBolusOk)
    expect(c.canEditDirect).toBe(false)
    expect(c.canPropose).toBe(true)
  })

  it("VIEWER (patient) : proposition seulement", () => {
    const c = deriveEditCapability("VIEWER" as Role, basalBolusOk)
    expect(c.canEditDirect).toBe(false)
    expect(c.canPropose).toBe(true)
  })

  it("ADMIN : écriture directe (bypass V1) mais PAS de proposition", () => {
    const c = deriveEditCapability("ADMIN" as Role, basalBolusOk)
    expect(c.canEditDirect).toBe(true)
    expect(c.canPropose).toBe(false)
  })
})

describe("deriveEditCapability — paramètres éditables par mode (fail-closed)", () => {
  it("basalBolus cohérent → ISF/ICR/basal éditables", () => {
    const c = deriveEditCapability("DOCTOR" as Role, basalBolusOk)
    expect(c.editableParameters).toEqual([
      "insulinSensitivityFactor",
      "insulinToCarbRatio",
      "basalRate",
    ])
    expect(c.blockedReason).toBeUndefined()
  })

  it("basalBolus INcohérent → rien d'éditable + blockedReason=incoherentConfig", () => {
    const c = deriveEditCapability("DOCTOR" as Role, basalBolusKo)
    expect(c.editableParameters).toEqual([])
    expect(c.blockedReason).toBe("incoherentConfig")
  })

  it("fixedDose → non éditable ici (non câblé) + modeNotEditable", () => {
    const c = deriveEditCapability("DOCTOR" as Role, fixed)
    expect(c.editableParameters).toEqual([])
    expect(c.blockedReason).toBe("modeNotEditable")
  })

  it("nonInsulin → pas d'éditeur insuline + modeNotEditable", () => {
    const c = deriveEditCapability("DOCTOR" as Role, none)
    expect(c.editableParameters).toEqual([])
    expect(c.blockedReason).toBe("modeNotEditable")
  })

  it("DOCTOR + basalBolus INcohérent : trio { canEditDirect:true, editableParameters:[], incoherentConfig }", () => {
    // Cas à surveiller côté UI (revue clinique) : écriture directe autorisée (réparation
    // possible via routes DOCTOR) MAIS éditeur guidé masqué → l'UI doit router vers « corriger ».
    const c = deriveEditCapability("DOCTOR" as Role, basalBolusKo)
    expect(c.canEditDirect).toBe(true)
    expect(c.editableParameters).toEqual([])
    expect(c.blockedReason).toBe("incoherentConfig")
  })

  it("les capacités de rôle sont indépendantes du mode", () => {
    // NURSE garde canPropose même sur un mode non éditable (mais editableParameters vide).
    const c = deriveEditCapability("NURSE" as Role, none)
    expect(c.canPropose).toBe(true)
    expect(c.editableParameters).toEqual([])
  })
})
