/**
 * Tests du mapping pur réglages insuline + traitements → vue dossier (Phase 3).
 * Couvre : créneaux ISF/ICR (g/L/U, g/U), basal (U/h + heures Time), méthode,
 * absence de réglages, listing des traitements associés (le modèle Treatment
 * n'a pas de soft-delete — tous les enregistrements sont listés).
 */

import { describe, it, expect } from "vitest"
import { buildTreatmentView, analyzeSlotCoverage } from "@/app/(dashboard)/patients/[id]/treatment-view"

describe("buildTreatmentView", () => {
  it("maps delivery method + per-slot ISF/ICR/basal (Decimal-like → number)", () => {
    const v = buildTreatmentView(
      {
        deliveryMethod: "pump",
        sensitivityFactors: [{ startHour: 0, endHour: 6, sensitivityFactorGl: "0.30" }],
        carbRatios: [{ startHour: 0, endHour: 6, gramsPerUnit: "10.0" }],
        basalConfiguration: {
          pumpSlots: [{ startTime: "1970-01-01T00:00:00.000Z", endTime: "1970-01-01T06:00:00.000Z", rate: "0.800" }],
        },
      },
      [],
    )
    expect(v.hasSettings).toBe(true)
    expect(v.deliveryMethod).toBe("pump")
    expect(v.isfSlots).toEqual([{ range: "00h–06h", value: 0.3 }])
    expect(v.icrSlots).toEqual([{ range: "00h–06h", value: 10 }])
    expect(v.basalSlots).toEqual([{ range: "00:00–06:00", rate: 0.8 }])
    // Un seul créneau 00–06 → trou sur le reste de la journée (garde-fou).
    expect(v.isfCoverage).toEqual({ hasGap: true, hasOverlap: false })
    expect(v.basalCoverage).toEqual({ hasGap: true, hasOverlap: false })
  })

  const NOW = new Date("2026-06-15T12:00:00.000Z")

  it("maps bolus insulin (catalog displayName/genericName + dosage) and active pump model", () => {
    const v = buildTreatmentView(
      {
        deliveryMethod: "pump",
        sensitivityFactors: [],
        carbRatios: [],
        basalConfiguration: null,
        bolusInsulin: {
          usage: "bolus",
          isActive: true,
          endDate: null,
          dosage: "6-8U avant repas",
          insulinCatalog: { displayName: "Humalog", genericName: "insulin lispro" },
        },
      },
      [],
      [
        // Pompe révoquée → ignorée ; pompe active retenue par fraîcheur de synchro.
        { category: "insulinPump", brand: "Roche", model: "Insight", revokedAt: "2025-01-01T00:00:00.000Z", createdAt: "2024-01-01T00:00:00.000Z" },
        { category: "insulinPump", brand: "Medtronic", model: "780G", revokedAt: null, lastSyncAt: "2026-06-15T08:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z" },
        { category: "cgm", brand: "Dexcom", model: "G7", revokedAt: null, createdAt: "2026-02-01T00:00:00.000Z" },
      ],
      NOW,
    )
    expect(v.bolusInsulin).toEqual({ name: "Humalog", genericName: "insulin lispro", dosage: "6-8U avant repas" })
    expect(v.pump).toEqual({ label: "Medtronic 780G", syncStale: false })
  })

  it("selects the pump with the freshest lastSyncAt and flags stale sync (> 7j or never)", () => {
    const v = buildTreatmentView(
      { deliveryMethod: "pump", sensitivityFactors: [], carbRatios: [], basalConfiguration: null },
      [],
      [
        { category: "insulinPump", brand: "Tandem", model: "t:slim X2", revokedAt: null, lastSyncAt: "2026-05-01T00:00:00.000Z", createdAt: "2026-04-01T00:00:00.000Z" },
        { category: "insulinPump", brand: "Roche", model: "Insight", revokedAt: null, lastSyncAt: "2026-03-01T00:00:00.000Z", createdAt: "2026-06-10T00:00:00.000Z" },
      ],
      NOW,
    )
    // lastSyncAt 2026-05-01 (> 7j avant NOW) gagne sur createdAt récent ; stale.
    expect(v.pump).toEqual({ label: "Tandem t:slim X2", syncStale: true })
  })

  it("falls back to device name when brand/model are absent, ignores non-pump devices", () => {
    const v = buildTreatmentView(
      { deliveryMethod: "manual", sensitivityFactors: [], carbRatios: [], basalConfiguration: null },
      [],
      [
        { category: "cgm", brand: "Dexcom", model: "G7", revokedAt: null, createdAt: "2026-02-01T00:00:00.000Z" },
        { category: "insulinPump", brand: null, model: null, name: "YpsoPump", revokedAt: null, lastSyncAt: "2026-06-15T09:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z" },
      ],
      NOW,
    )
    expect(v.bolusInsulin).toBeNull()
    expect(v.pump).toEqual({ label: "YpsoPump", syncStale: false })
  })

  it("suppresses bolus insulin when the linked record is inactive, ended, or non-bolus usage", () => {
    const cat = { displayName: "Humalog", genericName: "insulin lispro" }
    const base = { deliveryMethod: "pump" as const, sensitivityFactors: [], carbRatios: [], basalConfiguration: null }
    // isActive false
    expect(buildTreatmentView({ ...base, bolusInsulin: { usage: "bolus", isActive: false, insulinCatalog: cat } }, [], [], NOW).bolusInsulin).toBeNull()
    // endDate dans le passé
    expect(buildTreatmentView({ ...base, bolusInsulin: { usage: "bolus", isActive: true, endDate: "2026-01-01T00:00:00.000Z", insulinCatalog: cat } }, [], [], NOW).bolusInsulin).toBeNull()
    // usage basal → ne pas étiqueter « bolus »
    expect(buildTreatmentView({ ...base, bolusInsulin: { usage: "basal", isActive: true, insulinCatalog: cat } }, [], [], NOW).bolusInsulin).toBeNull()
    // usage both → accepté
    expect(buildTreatmentView({ ...base, bolusInsulin: { usage: "both", isActive: true, endDate: null, insulinCatalog: cat } }, [], [], NOW).bolusInsulin).toEqual({ name: "Humalog", genericName: "insulin lispro", dosage: null })
  })

  it("handles no settings (null) gracefully", () => {
    const v = buildTreatmentView(null, [])
    expect(v.hasSettings).toBe(false)
    expect(v.deliveryMethod).toBeNull()
    expect(v.bolusInsulin).toBeNull()
    expect(v.pump).toBeNull()
    expect(v.isfSlots).toEqual([])
    expect(v.basalSlots).toEqual([])
    // Aucun créneau → pas de garde-fou déclenché.
    expect(v.isfCoverage).toEqual({ hasGap: false, hasOverlap: false })
    expect(v.icrCoverage).toEqual({ hasGap: false, hasOverlap: false })
    expect(v.basalCoverage).toEqual({ hasGap: false, hasOverlap: false })
  })

  it("flags a full 24h continuous cover as clean (no gap, no overlap)", () => {
    const v = buildTreatmentView(
      {
        deliveryMethod: "manual",
        sensitivityFactors: [
          { startHour: 0, endHour: 8, sensitivityFactorGl: "0.30" },
          { startHour: 8, endHour: 22, sensitivityFactorGl: "0.40" },
          { startHour: 22, endHour: 24, sensitivityFactorGl: "0.35" },
        ],
        carbRatios: [],
        basalConfiguration: null,
      },
      [],
    )
    expect(v.isfCoverage).toEqual({ hasGap: false, hasOverlap: false })
  })

  it("handles manual delivery (no pump basal config)", () => {
    const v = buildTreatmentView(
      { deliveryMethod: "manual", sensitivityFactors: [], carbRatios: [], basalConfiguration: null },
      [],
    )
    expect(v.deliveryMethod).toBe("manual")
    expect(v.basalSlots).toEqual([])
  })

  it("lists all associated treatments (Treatment has no soft-delete)", () => {
    const v = buildTreatmentView(null, [
      { id: 1, name: "Metformine", posology: "850 mg x2/j" },
      { id: 2, name: "Autre", posology: null },
    ])
    expect(v.treatments).toEqual([
      { id: 1, name: "Metformine", posology: "850 mg x2/j" },
      { id: 2, name: "Autre", posology: null },
    ])
  })
})

describe("analyzeSlotCoverage", () => {
  it("reports no gap/overlap for a full continuous 24h cover", () => {
    expect(
      analyzeSlotCoverage([
        { start: 0, end: 480 },
        { start: 480, end: 1320 },
        { start: 1320, end: 1440 },
      ]),
    ).toEqual({ hasGap: false, hasOverlap: false })
  })

  it("detects a gap when a window is left uncovered", () => {
    // 00:00–06:00 puis 08:00–24:00 → trou 06:00–08:00.
    expect(
      analyzeSlotCoverage([
        { start: 0, end: 360 },
        { start: 480, end: 1440 },
      ]),
    ).toEqual({ hasGap: true, hasOverlap: false })
  })

  it("detects an overlap between two windows", () => {
    // 00:00–10:00 et 08:00–24:00 se chevauchent 08:00–10:00 (et couvrent 24h).
    expect(
      analyzeSlotCoverage([
        { start: 0, end: 600 },
        { start: 480, end: 1440 },
      ]),
    ).toEqual({ hasGap: false, hasOverlap: true })
  })

  it("handles a window crossing midnight (end <= start)", () => {
    // 22:00–06:00 (passe minuit) + 06:00–22:00 → couverture complète sans trou.
    expect(
      analyzeSlotCoverage([
        { start: 1320, end: 360 },
        { start: 360, end: 1320 },
      ]),
    ).toEqual({ hasGap: false, hasOverlap: false })
  })

  it("ignores degenerate zero-length slots", () => {
    expect(analyzeSlotCoverage([{ start: 600, end: 600 }])).toEqual({
      hasGap: false,
      hasOverlap: false,
    })
  })

  it("clamps out-of-range minute values into [0,1440]", () => {
    // end=1500 borné à 1440 ; couvre tout → pas de trou.
    expect(analyzeSlotCoverage([{ start: 0, end: 1500 }])).toEqual({
      hasGap: false,
      hasOverlap: false,
    })
  })
})
