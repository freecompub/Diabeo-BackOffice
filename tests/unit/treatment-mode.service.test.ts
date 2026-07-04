/**
 * US-2647 — Détection du mode de traitement.
 *
 * Comportement clinique testé : classer un patient en basalBolus / fixedDose /
 * nonInsulin à partir de sa config d'insulinothérapie, avec les garde-fous :
 *  - un DT1 n'est JAMAIS classé nonInsulin (fail-closed) ;
 *  - une config basal-bolus avec trou/chevauchement est marquée incohérente
 *    (édition/proposition à bloquer en aval).
 *
 * Risque : un mauvais classement autoriserait une édition d'insuline sur un
 * patient qui ne devrait pas (fail-open) — l'inverse de l'objectif d'US-2647.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// Le service importe `prisma` + `insulinService` au top → mocks via vi.hoisted
// (disponibles avant l'import statique du module sous test).
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
  basalConfigType: null,
}
const full24 = [{ startHour: 0, endHour: 24 }]

describe("deriveTreatmentMode — modes", () => {
  it("basalBolus + cohérent : ISF et ICR couvrent 24 h sans trou", () => {
    expect(deriveTreatmentMode({ ...base, isfSlots: full24, icrSlots: full24 })).toEqual({
      mode: "basalBolus",
      coherent: true,
    })
  })

  it("basalBolus + INCOHÉRENT : ISF laisse un trou (0–12 h seulement)", () => {
    const res = deriveTreatmentMode({
      ...base,
      isfSlots: [{ startHour: 0, endHour: 12 }],
      icrSlots: full24,
    })
    expect(res.mode).toBe("basalBolus")
    expect(res.coherent).toBe(false)
  })

  it("basalBolus + INCOHÉRENT : ICR se chevauche", () => {
    const res = deriveTreatmentMode({
      ...base,
      isfSlots: full24,
      icrSlots: [
        { startHour: 0, endHour: 14 },
        { startHour: 10, endHour: 24 },
      ],
    })
    expect(res.mode).toBe("basalBolus")
    expect(res.coherent).toBe(false)
  })

  it("fixedDose : insuline active sans ratios complets", () => {
    expect(deriveTreatmentMode({ ...base, hasActiveInsulin: true })).toEqual({
      mode: "fixedDose",
      coherent: true,
    })
  })

  it("fixedDose : config basale à injection unique (sans ratios)", () => {
    expect(deriveTreatmentMode({ ...base, basalConfigType: "single_injection" })).toEqual({
      mode: "fixedDose",
      coherent: true,
    })
  })

  it("fixedDose : ratios PARTIELS (ISF seul, pas d'ICR) → pas basalBolus", () => {
    expect(deriveTreatmentMode({ ...base, isfSlots: full24 })).toEqual({
      mode: "fixedDose",
      coherent: true,
    })
  })

  it("nonInsulin : DT2 sans aucune insuline", () => {
    expect(deriveTreatmentMode({ ...base, pathology: "DT2" })).toEqual({
      mode: "nonInsulin",
      coherent: true,
    })
  })

  it("nonInsulin : GD sans insuline (diététique)", () => {
    expect(deriveTreatmentMode({ ...base, pathology: "GD" })).toEqual({
      mode: "nonInsulin",
      coherent: true,
    })
  })
})

describe("deriveTreatmentMode — fail-closed pathologie", () => {
  it("DT1 sans aucune insuline → fixedDose (jamais nonInsulin)", () => {
    expect(deriveTreatmentMode({ ...base, pathology: "DT1" })).toEqual({
      mode: "fixedDose",
      coherent: true,
    })
  })

  it("DT1 avec ratios complets cohérents → basalBolus", () => {
    expect(
      deriveTreatmentMode({ ...base, pathology: "DT1", isfSlots: full24, icrSlots: full24 }),
    ).toEqual({ mode: "basalBolus", coherent: true })
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
    prismaMock.patientInsulin.findFirst.mockResolvedValue({ id: 1 })
    getSettings.mockResolvedValue({
      sensitivityFactors: full24,
      carbRatios: full24,
      basalConfiguration: { configType: "pump" },
    })
    await expect(resolveTreatmentMode(7)).resolves.toEqual({ mode: "basalBolus", coherent: true })
  })

  it("patient inexistant → throw patientNotFound", async () => {
    prismaMock.patient.findUnique.mockResolvedValue(null)
    await expect(resolveTreatmentMode(999)).rejects.toThrow("patientNotFound")
  })
})
