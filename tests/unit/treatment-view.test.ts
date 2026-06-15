/**
 * Tests du mapping pur réglages insuline + traitements → vue dossier (Phase 3).
 * Couvre : créneaux ISF/ICR (g/L/U, g/U), basal (U/h + heures Time), méthode,
 * absence de réglages, filtrage des traitements soft-deleted.
 */

import { describe, it, expect } from "vitest"
import { buildTreatmentView } from "@/app/(dashboard)/patients/[id]/treatment-view"

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
  })

  it("handles no settings (null) gracefully", () => {
    const v = buildTreatmentView(null, [])
    expect(v.hasSettings).toBe(false)
    expect(v.deliveryMethod).toBeNull()
    expect(v.isfSlots).toEqual([])
    expect(v.basalSlots).toEqual([])
  })

  it("handles manual delivery (no pump basal config)", () => {
    const v = buildTreatmentView(
      { deliveryMethod: "manual", sensitivityFactors: [], carbRatios: [], basalConfiguration: null },
      [],
    )
    expect(v.deliveryMethod).toBe("manual")
    expect(v.basalSlots).toEqual([])
  })

  it("lists active treatments and filters soft-deleted ones", () => {
    const v = buildTreatmentView(null, [
      { id: 1, name: "Metformine", posology: "850 mg x2/j" },
      { id: 2, name: "Ancien", posology: null, deletedAt: new Date("2026-01-01") },
    ])
    expect(v.treatments).toEqual([{ id: 1, name: "Metformine", posology: "850 mg x2/j" }])
  })
})
