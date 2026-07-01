/**
 * Tests — US-2637 `mealtimePattern` (tendances de repas).
 *
 * Sécurité clinique testée : moment dérivé de l'heure LOCALE, pré = dernier
 * relevé [t0−30, t0], pic dans la fenêtre d'excursion, après = PPG 2 h, plancher
 * de 3 repas appariés, seuils post-prandiaux pathology-aware (GD), audit
 * DIABETES_EVENT sans valeur clinique.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"
import { mealtimePattern } from "@/lib/services/meal-trends.service"

const DAY = 24 * 3600_000
const MIN = 60_000

/** Repas à 12:00 UTC sur les k derniers jours (→ créneau Midi en heure de Paris). */
function noonMeal(k: number, extra: Record<string, unknown> = {}) {
  const d = new Date()
  d.setUTCHours(12, 0, 0, 0)
  const t0 = d.getTime() - k * DAY
  return { id: `m${k}`, eventDate: new Date(t0), glycemiaValue: null, carbohydrates: 45, bolusDose: 6, ...extra, _t0: t0 }
}
/** Relevé CGM (g/L) à un offset en minutes du repas. */
const cgm = (t0: number, offMin: number, gl: number) => ({ valueGl: gl, timestamp: new Date(t0 + offMin * MIN) })

function setup(meals: ReturnType<typeof noonMeal>[], readings: unknown[], pathology: string | null = null) {
  prismaMock.patient.findFirst.mockResolvedValue({ pathology, pregnancyMode: false } as any)
  prismaMock.userDayMoment.findMany.mockResolvedValue([] as any) // défauts moments
  // loadContext : 1er findMany = repas insuline, 2e = apports glucidiques (bornage).
  prismaMock.diabetesEvent.findMany.mockResolvedValueOnce(meals as any).mockResolvedValueOnce([] as any)
  prismaMock.cgmEntry.findMany.mockResolvedValue(readings as any)
  prismaMock.auditLog.create.mockResolvedValue({} as any)
}

/** 3 relevés/repas : pré (t0−10, 1.0 g/L), pic (t0+60, 1.8), post 2 h (t0+120, 1.5). */
function readingsFor(meals: ReturnType<typeof noonMeal>[]) {
  return meals.flatMap((m) => [cgm(m._t0, -10, 1.0), cgm(m._t0, 60, 1.8), cgm(m._t0, 120, 1.5)])
}

describe("mealtimePattern.mealTrends", () => {
  beforeEach(() => vi.clearAllMocks())

  it("aggregates a noon curve from ≥3 paired meals (pré/après PPG 2h/pic)", async () => {
    const meals = [noonMeal(1), noonMeal(2), noonMeal(3)]
    setup(meals, readingsFor(meals))

    const { curve } = await mealtimePattern.mealTrends(42, "14d", 1, { ipAddress: "i", userAgent: "u", requestId: "r" })
    const noon = curve.moments.find((m) => m.moment === "noon")!
    expect(noon.insufficient).toBe(false)
    expect(noon.pairedMeals).toBe(3)
    expect(noon.avgPreMgdl).toBe(100) // 1.0 g/L → 100 mg/dL
    expect(noon.avgPostMgdl).toBe(150) // PPG 2 h
    expect(noon.avgPeakMgdl).toBe(180) // pic
    // Buckets alignés (−15 = pré, 60 = pic, 120 = post) présents.
    expect(noon.buckets.map((b) => b.offsetMin)).toEqual(expect.arrayContaining([-15, 60, 120]))
    // Adulte : plafond 180 → excursion (post 150) non élevée.
    expect(noon.targetHighMgdl).toBe(180)
    expect(noon.highExcursion).toBe(false)
  })

  it("flags « données insuffisantes » under 3 paired meals", async () => {
    const meals = [noonMeal(1), noonMeal(2)]
    setup(meals, readingsFor(meals))
    const { curve } = await mealtimePattern.mealTrends(42, "14d", 1)
    const noon = curve.moments.find((m) => m.moment === "noon")!
    expect(noon.insufficient).toBe(true)
    expect(noon.pairedMeals).toBe(2)
    expect(noon.avgPostMgdl).toBeNull()
    expect(noon.buckets).toEqual([])
  })

  it("uses pathology-aware post-prandial ceiling (GD 140) → high excursion flagged", async () => {
    const meals = [noonMeal(1), noonMeal(2), noonMeal(3)]
    setup(meals, readingsFor(meals), "GD")
    const { curve } = await mealtimePattern.mealTrends(42, "14d", 1)
    const noon = curve.moments.find((m) => m.moment === "noon")!
    expect(noon.targetHighMgdl).toBe(140) // GD 63–140
    expect(noon.highExcursion).toBe(true) // post 150 > 140
  })

  it("builds a numeric journal (pré/après/glucides/bolus), no free-text, sorted desc", async () => {
    const meals = [noonMeal(1), noonMeal(2), noonMeal(3)]
    setup(meals, readingsFor(meals))
    const { journal } = await mealtimePattern.mealTrends(42, "14d", 1)
    expect(journal).toHaveLength(3)
    const j = journal[0]
    expect(j).toMatchObject({ moment: "noon", preMgdl: 100, postMgdl: 150, carbs: 45, bolus: 6 })
    expect(Object.keys(j)).not.toContain("comment")
    // Tri desc : jour le plus récent (m1) en tête.
    expect(journal[0].mealId).toBe("m1")
    expect(journal[2].mealId).toBe("m3")
  })

  it("invalidates peak AND post when an intercurrent carb intake truncates the window (< 90 min) — M-1", async () => {
    const meals = [noonMeal(1), noonMeal(2), noonMeal(3)]
    prismaMock.patient.findFirst.mockResolvedValue({ pathology: null, pregnancyMode: false } as any)
    prismaMock.userDayMoment.findMany.mockResolvedValue([] as any)
    // 2e findMany = apports glucidiques : un snack à t0+60 tronque chaque fenêtre.
    const snacks = meals.map((m) => ({ eventDate: new Date(m._t0 + 60 * MIN) }))
    prismaMock.diabetesEvent.findMany.mockResolvedValueOnce(meals as any).mockResolvedValueOnce(snacks as any)
    prismaMock.cgmEntry.findMany.mockResolvedValue(readingsFor(meals) as any)
    prismaMock.auditLog.create.mockResolvedValue({} as any)

    const { curve } = await mealtimePattern.mealTrends(42, "14d", 1)
    const noon = curve.moments.find((m) => m.moment === "noon")!
    // Fenêtre 60 min < 90 → ni pic ni post → repas non appariés → insuffisant.
    expect(noon.insufficient).toBe(true)
  })

  it("bounds post PPG 2h AND aligned buckets by winEnd on partial truncation (90–180 min) — R1", async () => {
    const meals = [noonMeal(1), noonMeal(2), noonMeal(3)]
    prismaMock.patient.findFirst.mockResolvedValue({ pathology: null, pregnancyMode: false } as any)
    prismaMock.userDayMoment.findMany.mockResolvedValue([] as any)
    // Snack à t0+100 → fenêtre 100 min (≥ 90 → évaluable) mais tronquée.
    const snacks = meals.map((m) => ({ eventDate: new Date(m._t0 + 100 * MIN) }))
    prismaMock.diabetesEvent.findMany.mockResolvedValueOnce(meals as any).mockResolvedValueOnce(snacks as any)
    // Relevés : pré (−10, 1.0), pic (+60, 1.8), et post-snack (+120, 2.5) APRÈS winEnd.
    const readings = meals.flatMap((m) => [cgm(m._t0, -10, 1.0), cgm(m._t0, 60, 1.8), cgm(m._t0, 120, 2.5)])
    prismaMock.cgmEntry.findMany.mockResolvedValue(readings as any)
    prismaMock.auditLog.create.mockResolvedValue({} as any)

    const { curve } = await mealtimePattern.mealTrends(42, "14d", 1)
    const noon = curve.moments.find((m) => m.moment === "noon")!
    expect(noon.pairedMeals).toBe(3) // pré + pic
    expect(noon.avgPeakMgdl).toBe(180) // pic dans (t0, t0+100]
    // Le relevé post-snack (t0+120, 250) est APRÈS winEnd → ni post ni bucket.
    expect(noon.avgPostMgdl).toBeNull()
    expect(noon.buckets.map((b) => b.offsetMin)).not.toContain(120)
  })

  it("applies GD-strict post-prandial ceiling for a pregnant patient NOT typed GD (M-3)", async () => {
    const meals = [noonMeal(1), noonMeal(2), noonMeal(3)]
    prismaMock.patient.findFirst.mockResolvedValue({ pathology: "DT1", pregnancyMode: true } as any)
    prismaMock.userDayMoment.findMany.mockResolvedValue([] as any)
    prismaMock.diabetesEvent.findMany.mockResolvedValueOnce(meals as any).mockResolvedValueOnce([] as any)
    prismaMock.cgmEntry.findMany.mockResolvedValue(readingsFor(meals) as any)
    prismaMock.auditLog.create.mockResolvedValue({} as any)

    const { curve } = await mealtimePattern.mealTrends(42, "14d", 1)
    const noon = curve.moments.find((m) => m.moment === "noon")!
    expect(noon.targetHighMgdl).toBe(140) // grossesse → cibles GD malgré pathology DT1
    expect(noon.highExcursion).toBe(true) // post 150 > 140
  })

  it("BGM: matches pre/post capillary readings in local wall-clock space (DST-safe) — US-2639", async () => {
    // Repas à 10:00 UTC le 2026-06-25 (été Paris UTC+2 → 12:00 mural → Midi).
    const meal = {
      id: "b1",
      eventDate: new Date("2026-06-25T10:00:00Z"),
      carbohydrates: 45,
      bolusDose: 6,
    }
    prismaMock.patient.findFirst.mockResolvedValue({ pathology: null, pregnancyMode: false } as any)
    prismaMock.userDayMoment.findMany.mockResolvedValue([] as any)
    prismaMock.diabetesEvent.findMany
      .mockResolvedValueOnce([meal] as any)
      .mockResolvedValueOnce([{ eventDate: meal.eventDate }] as any) // apports glucidiques
    // Relevés capillaires : date (jour) + time (heure MURALE locale).
    const day = new Date("2026-06-25T00:00:00Z")
    const wall = (h: number, m: number) => new Date(Date.UTC(1970, 0, 1, h, m))
    prismaMock.glycemiaEntry.findMany.mockResolvedValue([
      { date: day, time: wall(11, 50), glycemiaGl: 1.0, glycemiaMgdl: null }, // pré (mural −10 min)
      { date: day, time: wall(14, 0), glycemiaGl: 1.6, glycemiaMgdl: null }, // post PPG 2 h (mural +120)
    ] as any)
    prismaMock.auditLog.create.mockResolvedValue({} as any)

    const { journal } = await mealtimePattern.mealTrends(42, "30d", 1, undefined, { source: "bgm" })
    expect(journal).toHaveLength(1)
    // Appariement mural correct malgré l'offset Paris (pas de décalage de 2 h).
    expect(journal[0]).toMatchObject({ moment: "noon", dayIso: "2026-06-25", preMgdl: 100, postMgdl: 160, carbs: 45, bolus: 6 })
  })

  it("BGM winter (UTC+1): pairs by wall-clock without a fixed +2h offset — US-2639 B1", async () => {
    // Repas à 11:00 UTC le 2026-01-15 (HIVER Paris UTC+1 → 12:00 mural → Midi).
    const meal = { id: "w1", eventDate: new Date("2026-01-15T11:00:00Z"), carbohydrates: 40, bolusDose: 5 }
    prismaMock.patient.findFirst.mockResolvedValue({ pathology: null, pregnancyMode: false } as any)
    prismaMock.userDayMoment.findMany.mockResolvedValue([] as any)
    prismaMock.diabetesEvent.findMany
      .mockResolvedValueOnce([meal] as any)
      .mockResolvedValueOnce([{ eventDate: meal.eventDate }] as any)
    const day = new Date("2026-01-15T00:00:00Z")
    const wall = (h: number, m: number) => new Date(Date.UTC(1970, 0, 1, h, m))
    prismaMock.glycemiaEntry.findMany.mockResolvedValue([
      { date: day, time: wall(11, 50), glycemiaGl: 1.0, glycemiaMgdl: null }, // pré mural −10
      { date: day, time: wall(14, 0), glycemiaGl: 1.5, glycemiaMgdl: null }, // post mural +120
    ] as any)
    prismaMock.auditLog.create.mockResolvedValue({} as any)

    const { journal } = await mealtimePattern.mealTrends(42, "90d", 1, undefined, { source: "bgm" })
    // Appariement mural correct en hiver (UTC+1) — prouve l'absence d'offset codé en dur.
    expect(journal[0]).toMatchObject({ moment: "noon", dayIso: "2026-01-15", preMgdl: 100, postMgdl: 150 })
  })

  it("BGM cross-midnight: post reading on the next calendar day is matched — US-2639 B1", async () => {
    // Repas à 21:30 UTC (été → 23:30 mural → Nuit) ; post PPG 2 h = 01:30 le lendemain.
    const meal = { id: "n1", eventDate: new Date("2026-06-25T21:30:00Z"), carbohydrates: 30, bolusDose: 4 }
    prismaMock.patient.findFirst.mockResolvedValue({ pathology: null, pregnancyMode: false } as any)
    prismaMock.userDayMoment.findMany.mockResolvedValue([] as any)
    prismaMock.diabetesEvent.findMany
      .mockResolvedValueOnce([meal] as any)
      .mockResolvedValueOnce([{ eventDate: meal.eventDate }] as any)
    const wall = (h: number, m: number) => new Date(Date.UTC(1970, 0, 1, h, m))
    prismaMock.glycemiaEntry.findMany.mockResolvedValue([
      { date: new Date("2026-06-25T00:00:00Z"), time: wall(23, 20), glycemiaGl: 1.0, glycemiaMgdl: null }, // pré (J, mural 23:20)
      { date: new Date("2026-06-26T00:00:00Z"), time: wall(1, 30), glycemiaGl: 2.0, glycemiaMgdl: null }, // post (J+1, mural 01:30 = +120)
    ] as any)
    prismaMock.auditLog.create.mockResolvedValue({} as any)

    const { journal } = await mealtimePattern.mealTrends(42, "30d", 1, undefined, { source: "bgm" })
    expect(journal[0]).toMatchObject({ moment: "night", preMgdl: 100, postMgdl: 200 })
  })

  it("BGM: no aligned curve is emitted by the service (AC-2 guaranteed server-side) — US-2639 B3", async () => {
    const meal = { id: "c1", eventDate: new Date("2026-06-25T10:00:00Z"), carbohydrates: 45, bolusDose: 6 }
    prismaMock.patient.findFirst.mockResolvedValue({ pathology: null, pregnancyMode: false } as any)
    prismaMock.userDayMoment.findMany.mockResolvedValue([] as any)
    prismaMock.diabetesEvent.findMany
      .mockResolvedValueOnce([meal] as any)
      .mockResolvedValueOnce([{ eventDate: meal.eventDate }] as any)
    prismaMock.glycemiaEntry.findMany.mockResolvedValue([
      { date: new Date("2026-06-25T00:00:00Z"), time: new Date(Date.UTC(1970, 0, 1, 11, 50)), glycemiaGl: 1.0, glycemiaMgdl: null },
    ] as any)
    prismaMock.auditLog.create.mockResolvedValue({} as any)

    const { curve } = await mealtimePattern.mealTrends(42, "14d", 1, undefined, { source: "bgm" })
    expect(curve.source).toBe("bgm")
    expect(curve.moments).toEqual([]) // aucune courbe alignée en BGM
  })

  it("audits READ DIABETES_EVENT with period/source, NO clinical value in metadata", async () => {
    const meals = [noonMeal(1)]
    setup(meals, readingsFor(meals))
    await mealtimePattern.mealTrends(42, "30d", 1, { ipAddress: "i", userAgent: "u", requestId: "r" })
    const data = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(data.resource).toBe("DIABETES_EVENT")
    expect(data.metadata).toMatchObject({ patientId: 42, kind: "mealtimePatterns", period: "30d", windowDays: 30, source: "cgm" })
    expect(JSON.stringify(data.metadata)).not.toMatch(/glucose|mgdl|150|180/i)
  })
})
