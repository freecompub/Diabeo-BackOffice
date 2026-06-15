/**
 * Tests — resolveTargetRangeMgdl (plage cible affichée du dossier).
 * Couvre la cohérence badge↔TIR : la borne haute = `ok` (plafond TIR), PAS
 * `high` (hyper sévère). Défauts pathology-aware (GD vs générique) + clamp.
 */
import { describe, it, expect } from "vitest"
import { resolveTargetRangeMgdl } from "@/app/(dashboard)/patients/[id]/overview-targets"

describe("resolveTargetRangeMgdl", () => {
  it("uses cgm.low/ok when an objective exists (ok = TIR ceiling, not high)", () => {
    // ok=1.80 → 180 (et non high=2.50 → 250)
    expect(resolveTargetRangeMgdl({ low: 0.7, ok: 1.8 }, "DT1")).toEqual({
      targetLowMgdl: 70,
      targetHighMgdl: 180,
    })
  })

  it("defaults to GD targets (63–140) when no objective + GD", () => {
    expect(resolveTargetRangeMgdl(null, "GD")).toEqual({ targetLowMgdl: 63, targetHighMgdl: 140 })
  })

  it("defaults to generic targets (70–180) when no objective + DT1/DT2/null", () => {
    expect(resolveTargetRangeMgdl(null, "DT1")).toEqual({ targetLowMgdl: 70, targetHighMgdl: 180 })
    expect(resolveTargetRangeMgdl(null, null)).toEqual({ targetLowMgdl: 70, targetHighMgdl: 180 })
  })

  it("clamps display targets strictly inside the severe zones (54 < low < high < 250)", () => {
    // Objectif aberrant : low=50, ok=300 → clampé.
    const r = resolveTargetRangeMgdl({ low: 0.5, ok: 3.0 }, "DT1")
    expect(r.targetLowMgdl).toBeGreaterThan(54)
    expect(r.targetHighMgdl).toBeLessThan(250)
    expect(r.targetLowMgdl).toBeLessThan(r.targetHighMgdl)
  })
})
