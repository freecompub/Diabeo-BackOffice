/**
 * US-2647 — Détection du mode de traitement.
 *
 * Comportement clinique testé : classer un patient en basalBolus / fixedDose /
 * nonInsulin à partir de sa config d'insulinothérapie, avec les garde-fous :
 *  - un DT1 — ou tout patient ayant déjà eu de l'insuline (config vidée) — n'est
 *    JAMAIS classé nonInsulin (fail-closed) ;
 *  - une config basal-bolus avec trou/chevauchement (ISF/ICR ou basale pompe),
 *    périmée (ratios sans insuline active) ou incomplète est marquée `coherent:false`.
 *
 * Risque : un mauvais classement autoriserait une édition d'insuline sur un patient
 * qui ne devrait pas, ou rétrograderait un insuliné en « non insuliné » (fail-open).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// Le service importe `prisma` + `insulinService` au top → mocks via vi.hoisted.
const { prismaMock, getSettings } = vi.hoisted(() => ({
  prismaMock: {
    patient: { findUnique: vi.fn() },
    patientInsulin: { findFirst: vi.fn() },
  },
  getSettings: vi.fn(),
}))
vi.mock("@/lib/db/client", () => ({ prisma: prismaMock }))
vi.mock("@/lib/services/insulin.service", () => ({
  insulinService: { getSettings },
}))

import {
  deriveTreatmentMode,
  resolveTreatmentMode,
  type DeriveTreatmentModeInput,
} from "@/lib/services/treatment-mode.service"

const base: DeriveTreatmentModeInput = {
  pathology: "DT2",
  isfSlots: [],
  icrSlots: [],
  hasActiveInsulin: false,
  hadInsulinEver: false,
  basalConfigType: null,
  basalSlots: [],
}
const full24 = [{ startHour: 0, endHour: 24 }]
const full24min = [{ start: 0, end: 1440 }]
/** Base d'un basal-bolus complet + insuline active (cas nominal). */
const bb: DeriveTreatmentModeInput = { ...base, hasActiveInsulin: true, isfSlots: full24, icrSlots: full24 }

describe("deriveTreatmentMode — basalBolus", () => {
  it("cohérent : ISF et ICR couvrent 24 h, insuline active", () => {
    expect(deriveTreatmentMode(bb)).toEqual({ mode: "basalBolus", coherent: true })
  })

  it("INCOHÉRENT : ISF laisse un trou (0–12 h)", () => {
    const res = deriveTreatmentMode({ ...bb, isfSlots: [{ startHour: 0, endHour: 12 }] })
    expect(res).toEqual({ mode: "basalBolus", coherent: false })
  })

  it("INCOHÉRENT : ICR se chevauche", () => {
    const res = deriveTreatmentMode({
      ...bb,
      icrSlots: [
        { startHour: 0, endHour: 14 },
        { startHour: 10, endHour: 24 },
      ],
    })
    expect(res).toEqual({ mode: "basalBolus", coherent: false })
  })

  it("PÉRIMÉ : ratios complets mais AUCUNE insuline active (droits périmés)", () => {
    const res = deriveTreatmentMode({ ...bb, hasActiveInsulin: false, hadInsulinEver: true })
    expect(res).toEqual({ mode: "basalBolus", coherent: false })
  })

  it("pompe : couverture basale avec trou → incohérent", () => {
    const res = deriveTreatmentMode({
      ...bb,
      basalConfigType: "pump",
      basalSlots: [{ start: 0, end: 720 }], // couvre 0–12 h seulement
    })
    expect(res).toEqual({ mode: "basalBolus", coherent: false })
  })

  it("pompe : couverture basale 24 h complète → cohérent", () => {
    const res = deriveTreatmentMode({ ...bb, basalConfigType: "pump", basalSlots: full24min })
    expect(res).toEqual({ mode: "basalBolus", coherent: true })
  })
})

describe("deriveTreatmentMode — fixedDose (réel)", () => {
  it("insuline active sans ratios complets", () => {
    expect(deriveTreatmentMode({ ...base, hasActiveInsulin: true })).toEqual({
      mode: "fixedDose",
      coherent: true,
    })
  })

  it("pré-mélangée (usage both) = insuline active → fixedDose cohérent", () => {
    // Les pré-mix (NovoMix/Humalog Mix) sont des doses fixes → hasActiveInsulin.
    expect(deriveTreatmentMode({ ...base, hasActiveInsulin: true, basalConfigType: null })).toEqual({
      mode: "fixedDose",
      coherent: true,
    })
  })

  it("schéma basal à injection unique (sans ratios)", () => {
    expect(deriveTreatmentMode({ ...base, basalConfigType: "single_injection" })).toEqual({
      mode: "fixedDose",
      coherent: true,
    })
  })

  it("ISF seul MAIS insuline active → fixedDose cohérent (correction ISF préservée)", () => {
    expect(deriveTreatmentMode({ ...base, hasActiveInsulin: true, isfSlots: full24 })).toEqual({
      mode: "fixedDose",
      coherent: true,
    })
  })
})

describe("deriveTreatmentMode — fixedDose INCOMPLET (coherent:false)", () => {
  it("pompe sans ratios → à configurer", () => {
    expect(deriveTreatmentMode({ ...base, basalConfigType: "pump" })).toEqual({
      mode: "fixedDose",
      coherent: false,
    })
  })

  it("ratios PARTIELS (ISF seul) sans insuline active → à configurer", () => {
    expect(deriveTreatmentMode({ ...base, isfSlots: full24 })).toEqual({
      mode: "fixedDose",
      coherent: false,
    })
  })
})

describe("deriveTreatmentMode — nonInsulin", () => {
  it("DT2 sans aucune insuline (ni actuelle ni passée)", () => {
    expect(deriveTreatmentMode({ ...base, pathology: "DT2" })).toEqual({
      mode: "nonInsulin",
      coherent: true,
    })
  })

  it("GD sans insuline (diététique)", () => {
    expect(deriveTreatmentMode({ ...base, pathology: "GD" })).toEqual({
      mode: "nonInsulin",
      coherent: true,
    })
  })
})

describe("deriveTreatmentMode — fail-closed", () => {
  it("DT1 sans aucune insuline → fixedDose à revoir (jamais nonInsulin)", () => {
    expect(deriveTreatmentMode({ ...base, pathology: "DT1" })).toEqual({
      mode: "fixedDose",
      coherent: false,
    })
  })

  it("DT2 config VIDÉE mais insuline historique → fixedDose à revoir (jamais nonInsulin)", () => {
    expect(deriveTreatmentMode({ ...base, pathology: "DT2", hadInsulinEver: true })).toEqual({
      mode: "fixedDose",
      coherent: false,
    })
  })

  it("DT1 avec ratios complets cohérents + insuline active → basalBolus", () => {
    expect(deriveTreatmentMode({ ...bb, pathology: "DT1" })).toEqual({
      mode: "basalBolus",
      coherent: true,
    })
  })
})

describe("resolveTreatmentMode — lecture DB", () => {
  beforeEach(() => {
    prismaMock.patient.findUnique.mockReset()
    prismaMock.patientInsulin.findFirst.mockReset()
    getSettings.mockReset()
  })

  it("assemble les entrées et dérive (basalBolus cohérent)", async () => {
    prismaMock.patient.findUnique.mockResolvedValue({ pathology: "DT1" })
    prismaMock.patientInsulin.findFirst.mockResolvedValue({ id: 1 }) // active + any
    getSettings.mockResolvedValue({
      sensitivityFactors: full24,
      carbRatios: full24,
      basalConfiguration: { configType: "pump", pumpSlots: [] },
    })
    await expect(resolveTreatmentMode(7)).resolves.toEqual({ mode: "basalBolus", coherent: true })
  })

  it("patient inexistant → throw patientNotFound", async () => {
    prismaMock.patient.findUnique.mockResolvedValue(null)
    await expect(resolveTreatmentMode(999)).rejects.toThrow("patientNotFound")
  })
})
