/**
 * Tests du mapping pur CGM → vue dossier patient (Phase 2).
 * Couvre : conversion g/L→mg/dL, sélection du dernier relevé (ordre asc),
 * exclusion valueGl null, calcul d'âge + drapeau `stale`.
 */

import { describe, it, expect } from "vitest"
import { buildGlycemiaView, CGM_STALE_AFTER_MIN } from "@/app/(dashboard)/patients/[id]/glycemia-view"

const NOW = new Date("2026-06-15T12:00:00.000Z")
const iso = (minAgo: number) => new Date(NOW.getTime() - minAgo * 60_000).toISOString()

describe("buildGlycemiaView", () => {
  it("converts g/L → mg/dL (×100, rounded) for chart points", () => {
    const v = buildGlycemiaView(
      [{ valueGl: 1.2, timestamp: iso(10) }, { valueGl: 0.825, timestamp: iso(5) }],
      NOW,
    )
    expect(v.points.map((p) => p.glucose)).toEqual([120, 83]) // 0.825*100=82.5 → 83
  })

  it("picks the newest entry as last reading (input ordered asc)", () => {
    const v = buildGlycemiaView(
      [{ valueGl: 1.0, timestamp: iso(60) }, { valueGl: 1.5, timestamp: iso(2) }],
      NOW,
    )
    expect(v.lastReadingMgdl).toBe(150)
    expect(v.lastReadingAgeMin).toBe(2)
    expect(v.stale).toBe(false)
  })

  it("flags stale when the newest reading is older than the threshold", () => {
    const v = buildGlycemiaView([{ valueGl: 0.6, timestamp: iso(CGM_STALE_AFTER_MIN + 1) }], NOW)
    expect(v.stale).toBe(true)
    expect(v.lastReadingMgdl).toBe(60)
  })

  it("excludes null valueGl entries and handles the empty case", () => {
    const v = buildGlycemiaView([{ valueGl: null, timestamp: iso(1) }], NOW)
    expect(v.points).toEqual([])
    expect(v.lastReadingMgdl).toBeNull()
    expect(v.lastReadingAgeMin).toBeNull()
    expect(v.stale).toBe(false)
    expect(v.recentOutOfRange).toBeNull()
  })

  it("flags recentOutOfRange=low when a more recent below-floor reading was excluded", () => {
    // Dernier relevé affiché bénin à -10 min ; relevé brut hors plancher à -2 min.
    const v = buildGlycemiaView(
      [{ valueGl: 0.9, timestamp: iso(10) }],
      NOW,
      { timestamp: iso(2), belowFloor: true, aboveCeiling: false },
    )
    expect(v.lastReadingMgdl).toBe(90) // l'affiché reste le bénin
    expect(v.recentOutOfRange).toBe("low")
  })

  it("flags recentOutOfRange even when there is NO displayable reading", () => {
    const v = buildGlycemiaView([], NOW, { timestamp: iso(3), belowFloor: true, aboveCeiling: false })
    expect(v.points).toEqual([])
    expect(v.recentOutOfRange).toBe("low")
  })

  it("flags recentOutOfRange=high for an above-ceiling most-recent raw reading", () => {
    const v = buildGlycemiaView(
      [{ valueGl: 1.1, timestamp: iso(15) }],
      NOW,
      { timestamp: iso(1), belowFloor: false, aboveCeiling: true },
    )
    expect(v.recentOutOfRange).toBe("high")
  })

  it("does NOT flag when the out-of-range raw reading is OLDER than the displayed one", () => {
    const v = buildGlycemiaView(
      [{ valueGl: 1.1, timestamp: iso(2) }],
      NOW,
      { timestamp: iso(30), belowFloor: true, aboveCeiling: false },
    )
    expect(v.recentOutOfRange).toBeNull()
  })

  it("does NOT flag when the most-recent raw reading is in range", () => {
    const v = buildGlycemiaView(
      [{ valueGl: 1.1, timestamp: iso(5) }],
      NOW,
      { timestamp: iso(1), belowFloor: false, aboveCeiling: false },
    )
    expect(v.recentOutOfRange).toBeNull()
  })
})
