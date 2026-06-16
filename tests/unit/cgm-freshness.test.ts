/**
 * Tests du croisement de fraîcheur CGM (sécurité clinique) — `recentOutOfRangeFrom`.
 *
 * Comportement clinique testé : un relevé hors plage (hypo sévère < 40 mg/dL /
 * capteur LOW, ou > 500 mg/dL / capteur HIGH) PLUS RÉCENT que le dernier relevé
 * affiché — ou présent alors qu'aucun relevé n'est affichable — doit être
 * signalé pour éviter qu'un relevé bénin plus ancien masque une hypo sévère.
 * Risque associé : fausse réassurance → hypoglycémie sévère non traitée.
 */
import { describe, it, expect } from "vitest"
import { recentOutOfRangeFrom } from "@/lib/cgm-freshness"

const T = (iso: string) => iso

describe("recentOutOfRangeFrom", () => {
  it("returns null when there is no raw signal", () => {
    expect(recentOutOfRangeFrom(T("2026-06-15T12:00:00Z"), null)).toBeNull()
    expect(recentOutOfRangeFrom(null, undefined)).toBeNull()
  })

  it("returns null when the raw reading is in range", () => {
    expect(
      recentOutOfRangeFrom(T("2026-06-15T11:00:00Z"), {
        timestamp: "2026-06-15T11:55:00Z",
        belowFloor: false,
        aboveCeiling: false,
      }),
    ).toBeNull()
  })

  it("flags low when a below-floor reading is newer than the displayed one", () => {
    expect(
      recentOutOfRangeFrom(T("2026-06-15T11:00:00Z"), {
        timestamp: "2026-06-15T11:58:00Z",
        belowFloor: true,
        aboveCeiling: false,
      }),
    ).toBe("low")
  })

  it("flags high for a newer above-ceiling reading", () => {
    expect(
      recentOutOfRangeFrom(T("2026-06-15T11:00:00Z"), {
        timestamp: "2026-06-15T11:58:00Z",
        belowFloor: false,
        aboveCeiling: true,
      }),
    ).toBe("high")
  })

  it("flags when there is NO displayable reading (most dangerous case)", () => {
    expect(
      recentOutOfRangeFrom(null, {
        timestamp: "2026-06-15T11:58:00Z",
        belowFloor: true,
        aboveCeiling: false,
      }),
    ).toBe("low")
  })

  it("does NOT flag when the out-of-range reading is older than the displayed one", () => {
    expect(
      recentOutOfRangeFrom(T("2026-06-15T11:59:00Z"), {
        timestamp: "2026-06-15T11:00:00Z",
        belowFloor: true,
        aboveCeiling: false,
      }),
    ).toBeNull()
  })

  it("does NOT flag on an equal timestamp (strict newer)", () => {
    const ts = "2026-06-15T11:30:00Z"
    expect(recentOutOfRangeFrom(ts, { timestamp: ts, belowFloor: true, aboveCeiling: false })).toBeNull()
  })
})
