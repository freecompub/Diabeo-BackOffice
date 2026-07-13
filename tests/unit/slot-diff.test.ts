/**
 * US-2663 (S2) — DIFF pur (live → proposé) pour l'écran de revue médecin (`slot-diff.ts`).
 *
 * Comportement clinique testé : une ligne PAR créneau PROPOSÉ, annotée de sa valeur live appariée par
 * `startHour` ; `changed` si la valeur, la borne de fin, ou la présence même du créneau live diffère (au-delà
 * de la tolérance flottante `BASELINE_VALUE_EPS`). `hasStructuralChange` signale en complément une
 * suppression de créneau (côté live, absent du proposé) que `diffSlots` seul ne rend pas visible (il n'itère
 * que sur le côté proposé).
 */
import { describe, it, expect } from "vitest"
import { diffSlots, diffPumpSlots, diffFixedDoseSlots, diffStyloBasalSlots, hasStructuralChange, hasStructuralChangePump, hasStructuralChangeFixedDose, hasStructuralChangeStylo } from "@/lib/insulin/slot-diff"
import { BASELINE_VALUE_EPS } from "@/lib/insulin/slot-baseline-cas"

const LIVE = [
  { startHour: 0, endHour: 8, value: 0.5 },
  { startHour: 8, endHour: 22, value: 0.45 },
  { startHour: 22, endHour: 0, value: 0.4 },
]

describe("diffSlots", () => {
  it("jeu identique → toutes les lignes non `changed`, `liveValue` apparié", () => {
    const rows = diffSlots(LIVE, [...LIVE])
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => !r.changed)).toBe(true)
    expect(rows.map((r) => r.liveValue)).toEqual([0.5, 0.45, 0.4])
  })

  it("trie les lignes par startHour (jeu proposé désordonné)", () => {
    const shuffled = [LIVE[2], LIVE[0], LIVE[1]]
    const rows = diffSlots(LIVE, shuffled)
    expect(rows.map((r) => r.startHour)).toEqual([0, 8, 22])
  })

  it("écart de valeur sous la tolérance flottante → non `changed`", () => {
    const proposed = LIVE.map((s, i) => (i === 0 ? { ...s, value: s.value + BASELINE_VALUE_EPS / 2 } : s))
    const rows = diffSlots(LIVE, proposed)
    expect(rows[0]!.changed).toBe(false)
  })

  it("valeur différente sur un créneau → `changed` UNIQUEMENT sur ce créneau", () => {
    const proposed = LIVE.map((s, i) => (i === 1 ? { ...s, value: 0.6 } : s))
    const rows = diffSlots(LIVE, proposed)
    expect(rows[0]!.changed).toBe(false)
    expect(rows[1]!.changed).toBe(true)
    expect(rows[1]!.proposedValue).toBe(0.6)
    expect(rows[1]!.liveValue).toBe(0.45)
    expect(rows[2]!.changed).toBe(false)
  })

  it("borne de fin différente → `changed`", () => {
    const proposed = LIVE.map((s, i) => (i === 0 ? { ...s, endHour: 9 } : s))
    const rows = diffSlots(LIVE, proposed)
    expect(rows[0]!.changed).toBe(true)
  })

  it("créneau proposé sans correspondance live (startHour nouveau) → `liveValue` null, `changed` true", () => {
    const proposed = [{ startHour: 5, endHour: 8, value: 0.55 }, ...LIVE.slice(1)]
    const rows = diffSlots(LIVE, proposed)
    const newRow = rows.find((r) => r.startHour === 5)
    expect(newRow?.liveValue).toBeNull()
    expect(newRow?.changed).toBe(true)
  })

  it("mealLabel (ICR) porté sur la ligne quand présent", () => {
    const rows = diffSlots(
      [{ startHour: 0, endHour: 12, value: 10, mealLabel: "midi" }],
      [{ startHour: 0, endHour: 12, value: 10, mealLabel: "midi" }],
    )
    expect(rows[0]!.mealLabel).toBe("midi")
  })

  it("jeu proposé VIDE → aucune ligne côté proposé, mais les créneaux live supprimés sont rendus (removed)", () => {
    const rows = diffSlots(LIVE, [])
    expect(rows).toHaveLength(3) // les 3 créneaux live deviennent des lignes « supprimées »
    expect(rows.every((r) => r.removed && r.proposedValue === null && r.changed)).toBe(true)
    expect(rows.map((r) => r.liveValue)).toEqual([0.5, 0.45, 0.4])
  })

  it("config live VIDE → chaque créneau proposé est `changed` avec `liveValue` null (aucune suppression)", () => {
    const rows = diffSlots([], LIVE)
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.changed && r.liveValue === null && !r.removed)).toBe(true)
  })

  it("garde NaN : une valeur LIVE non finie force `changed` (jamais « inchangé » silencieux)", () => {
    const proposed = [{ startHour: 0, endHour: 8, value: 0.5 }]
    const rows = diffSlots([{ startHour: 0, endHour: 8, value: Number.NaN }], proposed)
    expect(rows[0]!.changed).toBe(true)
  })

  it("créneau LIVE SUPPRIMÉ (absent du proposé) → ligne dédiée `removed`, triée par startHour", () => {
    // Proposé retire le créneau 8→22 ; garde 0→8 et 22→0.
    const proposed = [LIVE[0]!, LIVE[2]!]
    const rows = diffSlots(LIVE, proposed)
    expect(rows.map((r) => r.startHour)).toEqual([0, 8, 22]) // le supprimé (8) réinséré à sa place
    const removed = rows.find((r) => r.startHour === 8)!
    expect(removed.removed).toBe(true)
    expect(removed.proposedValue).toBeNull()
    expect(removed.liveValue).toBe(0.45)
    expect(removed.changed).toBe(true)
  })
})

describe("hasStructuralChange", () => {
  it("même cardinalité, mêmes startHour → false", () => {
    expect(hasStructuralChange(LIVE, [...LIVE])).toBe(false)
  })

  it("cardinalité différente (créneau supprimé côté proposé) → true", () => {
    expect(hasStructuralChange(LIVE, LIVE.slice(0, 2))).toBe(true)
  })

  it("même cardinalité mais un créneau LIVE absent du proposé (déplacé) → true", () => {
    const proposed = [{ startHour: 1, endHour: 8, value: 0.5 }, LIVE[1]!, LIVE[2]!]
    expect(hasStructuralChange(LIVE, proposed)).toBe(true)
  })

  it("un créneau proposé en plus (cardinalité différente) → true", () => {
    expect(hasStructuralChange(LIVE, [...LIVE, { startHour: 6, endHour: 8, value: 0.3 }])).toBe(true)
  })
})

describe("diffPumpSlots (US-2663 S3c) — DIFF POMPE par startTime, temps EXACTS", () => {
  const LIVE = [
    { startTime: "00:00", endTime: "05:30", rate: 0.8 },
    { startTime: "05:30", endTime: "00:00", rate: 1.1 },
  ]

  it("débit nocturne changé → ligne `changed`, timeLabel EXACT, autres inchangés", () => {
    const proposed = [{ startTime: "00:00", endTime: "05:30", rate: 0.85 }, LIVE[1]!]
    const rows = diffPumpSlots(LIVE, proposed)
    expect(rows).toHaveLength(2)
    const noct = rows.find((r) => r.timeLabel === "00:00–05:30")!
    expect(noct).toMatchObject({ proposedValue: 0.85, liveValue: 0.8, changed: true, startHour: 0, endHour: 5 })
    expect(rows.find((r) => r.timeLabel === "05:30–00:00")!.changed).toBe(false)
  })

  it("créneau supprimé (startTime live absent du proposé) → ligne removed", () => {
    const rows = diffPumpSlots(LIVE, [LIVE[0]!])
    const removed = rows.find((r) => r.removed)
    expect(removed).toMatchObject({ timeLabel: "05:30–00:00", proposedValue: null, liveValue: 1.1 })
  })

  it("borne endTime déplacée (même startTime) → changed", () => {
    const rows = diffPumpSlots(LIVE, [{ startTime: "00:00", endTime: "06:00", rate: 0.8 }, LIVE[1]!])
    expect(rows.find((r) => r.startHour === 0)!.changed).toBe(true)
  })

  it("hasStructuralChangePump : cardinalité ou startTime live orphelin → true", () => {
    expect(hasStructuralChangePump(LIVE, [LIVE[0]!])).toBe(true)
    expect(hasStructuralChangePump(LIVE, [{ startTime: "01:00", endTime: "05:30", rate: 0.8 }, LIVE[1]!])).toBe(true)
    expect(hasStructuralChangePump(LIVE, [...LIVE])).toBe(false)
  })
})

describe("diffFixedDoseSlots (US-2663 S3d) — DIFF DOSE FIXE par (usage, moment)", () => {
  const LIVE = [
    { usage: "bolus" as const, moment: "morning" as const, value: 6 },
    { usage: "basal" as const, moment: "evening" as const, value: 20 },
  ]

  it("dose changée → changed, usage/moment portés, autres inchangées ; tri par ordre de moment", () => {
    const rows = diffFixedDoseSlots(LIVE, [{ usage: "bolus", moment: "morning", value: 7 }, LIVE[1]!])
    expect(rows).toHaveLength(2)
    const m = rows.find((r) => r.usage === "bolus" && r.moment === "morning")!
    expect(m).toMatchObject({ proposedValue: 7, liveValue: 6, changed: true })
    expect(rows.find((r) => r.moment === "evening")!.changed).toBe(false)
    expect(rows[0]!.moment).toBe("morning") // morning(0) avant evening(2)
  })

  it("même moment mais usages DIFFÉRENTS → deux lignes distinctes (clé (usage,moment))", () => {
    const live = [{ usage: "bolus" as const, moment: "evening" as const, value: 6 }, { usage: "basal" as const, moment: "evening" as const, value: 20 }]
    const rows = diffFixedDoseSlots(live, [{ usage: "bolus", moment: "evening", value: 7 }, live[1]!])
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.usage === "bolus")!.changed).toBe(true)
    expect(rows.find((r) => r.usage === "basal")!.changed).toBe(false)
  })

  it("dose supprimée (clé live absente du proposé) → ligne removed", () => {
    const rows = diffFixedDoseSlots(LIVE, [LIVE[0]!])
    expect(rows.find((r) => r.removed)).toMatchObject({ usage: "basal", moment: "evening", proposedValue: null, liveValue: 20 })
  })

  it("hasStructuralChangeFixedDose : cardinalité ou clé live orpheline → true", () => {
    expect(hasStructuralChangeFixedDose(LIVE, [LIVE[0]!])).toBe(true)
    expect(hasStructuralChangeFixedDose(LIVE, [{ usage: "bolus", moment: "night", value: 6 }, LIVE[1]!])).toBe(true)
    expect(hasStructuralChangeFixedDose(LIVE, [...LIVE])).toBe(false)
  })
})

describe("diffStyloBasalSlots (US-2663 S3e) — DIFF BASALE STYLO par kind, U totales", () => {
  const SPLIT = [
    { kind: "morning" as const, value: 12 },
    { kind: "evening" as const, value: 10 },
  ]

  it("dose du soir changée → changed, basalDoseKind porté, matin inchangée ; tri morning avant evening", () => {
    const rows = diffStyloBasalSlots(SPLIT, [SPLIT[0]!, { kind: "evening", value: 8 }])
    expect(rows).toHaveLength(2)
    const ev = rows.find((r) => r.basalDoseKind === "evening")!
    expect(ev).toMatchObject({ proposedValue: 8, liveValue: 10, changed: true })
    expect(rows.find((r) => r.basalDoseKind === "morning")!.changed).toBe(false)
    expect(rows[0]!.basalDoseKind).toBe("morning") // morning(0) avant evening(1)
  })

  it("single {daily} : dose changée → changed, basalDoseKind daily porté", () => {
    const rows = diffStyloBasalSlots([{ kind: "daily", value: 20 }], [{ kind: "daily", value: 22 }])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ basalDoseKind: "daily", proposedValue: 22, liveValue: 20, changed: true })
  })

  it("nouvelle dose (kind absent du live) → liveValue null, changed", () => {
    const rows = diffStyloBasalSlots([{ kind: "morning", value: 12 }], SPLIT)
    expect(rows.find((r) => r.basalDoseKind === "evening")).toMatchObject({ liveValue: null, proposedValue: 10, changed: true })
  })

  it("dose supprimée (kind live absent du proposé) → ligne removed", () => {
    const rows = diffStyloBasalSlots(SPLIT, [SPLIT[0]!])
    expect(rows.find((r) => r.removed)).toMatchObject({ basalDoseKind: "evening", proposedValue: null, liveValue: 10 })
  })

  it("hasStructuralChangeStylo : cardinalité ou kind live orphelin → true", () => {
    expect(hasStructuralChangeStylo(SPLIT, [SPLIT[0]!])).toBe(true)
    expect(hasStructuralChangeStylo([{ kind: "daily", value: 20 }], SPLIT)).toBe(true)
    expect(hasStructuralChangeStylo(SPLIT, [...SPLIT])).toBe(false)
  })
})
