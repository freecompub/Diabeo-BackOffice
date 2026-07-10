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
    const c = deriveEditCapability("DOCTOR" as Role, basalBolusOk, "JUNIOR")
    expect(c.canEditDirect).toBe(true)
    expect(c.canPropose).toBe(true)
  })

  it("NURSE : proposition seulement (pas d'écriture directe)", () => {
    const c = deriveEditCapability("NURSE" as Role, basalBolusOk, "JUNIOR")
    expect(c.canEditDirect).toBe(false)
    expect(c.canPropose).toBe(true)
  })

  it("VIEWER (patient) : proposition seulement", () => {
    const c = deriveEditCapability("VIEWER" as Role, basalBolusOk, "JUNIOR")
    expect(c.canEditDirect).toBe(false)
    expect(c.canPropose).toBe(true)
  })

  it("ADMIN : écriture directe (bypass V1) mais PAS de proposition", () => {
    const c = deriveEditCapability("ADMIN" as Role, basalBolusOk, "JUNIOR")
    expect(c.canEditDirect).toBe(true)
    expect(c.canPropose).toBe(false)
  })
})

describe("deriveEditCapability — paramètres éditables par mode (fail-closed)", () => {
  it("basalBolus cohérent → ISF/ICR/basal éditables", () => {
    const c = deriveEditCapability("DOCTOR" as Role, basalBolusOk, "JUNIOR")
    expect(c.editableParameters).toEqual([
      "insulinSensitivityFactor",
      "insulinToCarbRatio",
      "basalRate",
    ])
    expect(c.blockedReason).toBeUndefined()
  })

  it("basalBolus INcohérent → rien d'éditable + blockedReason=incoherentConfig", () => {
    const c = deriveEditCapability("DOCTOR" as Role, basalBolusKo, "JUNIOR")
    expect(c.editableParameters).toEqual([])
    expect(c.blockedReason).toBe("incoherentConfig")
  })

  it("fixedDose → non éditable ici (non câblé) + modeNotEditable", () => {
    const c = deriveEditCapability("DOCTOR" as Role, fixed, "JUNIOR")
    expect(c.editableParameters).toEqual([])
    expect(c.blockedReason).toBe("modeNotEditable")
  })

  it("nonInsulin → pas d'éditeur insuline + modeNotEditable", () => {
    const c = deriveEditCapability("DOCTOR" as Role, none, "JUNIOR")
    expect(c.editableParameters).toEqual([])
    expect(c.blockedReason).toBe("modeNotEditable")
  })

  it("DOCTOR + basalBolus INcohérent : trio { canEditDirect:true, editableParameters:[], incoherentConfig }", () => {
    // Cas à surveiller côté UI (revue clinique) : écriture directe autorisée (réparation
    // possible via routes DOCTOR) MAIS éditeur guidé masqué → l'UI doit router vers « corriger ».
    const c = deriveEditCapability("DOCTOR" as Role, basalBolusKo, "JUNIOR")
    expect(c.canEditDirect).toBe(true)
    expect(c.editableParameters).toEqual([])
    expect(c.blockedReason).toBe("incoherentConfig")
  })

  it("les capacités de rôle sont indépendantes du mode", () => {
    // NURSE garde canPropose même sur un mode non éditable (mais editableParameters vide).
    const c = deriveEditCapability("NURSE" as Role, none, "JUNIOR")
    expect(c.canPropose).toBe(true)
    expect(c.editableParameters).toEqual([])
  })
})

describe("deriveEditCapability — restructuration gatée par la maturité (US-2657)", () => {
  it("DOCTOR : canEditSlots (direct), quelle que soit la maturité", () => {
    expect(deriveEditCapability("DOCTOR" as Role, basalBolusOk, "JUNIOR").canEditSlots).toBe(true)
  })

  it("NURSE : canEditSlots (clinicien), non gaté par la maturité du patient", () => {
    expect(deriveEditCapability("NURSE" as Role, basalBolusOk, "JUNIOR").canEditSlots).toBe(true)
  })

  it("PATIENT (VIEWER) JUNIOR : PAS de restructuration (valeurs seulement)", () => {
    const c = deriveEditCapability("VIEWER" as Role, basalBolusOk, "JUNIOR")
    expect(c.canPropose).toBe(true)
    expect(c.canEditSlots).toBe(false)
    expect(c.maturityLevel).toBe("JUNIOR")
  })

  it("canSetMaturity : DOCTOR oui ; NURSE/ADMIN/VIEWER non (exactement DOCTOR)", () => {
    expect(deriveEditCapability("DOCTOR" as Role, basalBolusOk, "JUNIOR").canSetMaturity).toBe(true)
    expect(deriveEditCapability("NURSE" as Role, basalBolusOk, "JUNIOR").canSetMaturity).toBe(false)
    expect(deriveEditCapability("ADMIN" as Role, basalBolusOk, "JUNIOR").canSetMaturity).toBe(false)
    expect(deriveEditCapability("VIEWER" as Role, basalBolusOk, "JUNIOR").canSetMaturity).toBe(false)
  })

  it("PATIENT (VIEWER) INTERMEDIATE : restructuration autorisée", () => {
    expect(deriveEditCapability("VIEWER" as Role, basalBolusOk, "INTERMEDIATE").canEditSlots).toBe(true)
  })

  it("PATIENT (VIEWER) CONFIRME : restructuration autorisée", () => {
    expect(deriveEditCapability("VIEWER" as Role, basalBolusOk, "CONFIRME").canEditSlots).toBe(true)
  })

  it("fail-closed : config incohérente → pas de restructuration même pour un intermédiaire", () => {
    expect(deriveEditCapability("VIEWER" as Role, basalBolusKo, "INTERMEDIATE").canEditSlots).toBe(false)
  })
})
