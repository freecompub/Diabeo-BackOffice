/**
 * Tests — US-2639 `analyticsService.bgmDailyPatternByMoment` (carnet BGM).
 *
 * Sécurité clinique : rattachement au moment par heure LOCALE murale, moyenne
 * par moment, plancher de suffisance (< 3 relevés → « données insuffisantes »,
 * jamais une moyenne sur 1–2 relevés), seuils pathology-aware, audit
 * GLYCEMIA_ENTRY sans valeur clinique.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"
import { analyticsService } from "@/lib/services/analytics.service"

/** Relevé capillaire à une heure murale (g/L). */
const bgm = (hour: number, gl: number) => ({
  glycemiaGl: gl,
  glycemiaMgdl: null,
  time: new Date(Date.UTC(1970, 0, 1, hour, 0)),
})

function setup(rows: unknown[], pathology: string | null = null) {
  prismaMock.cgmObjective.findUnique.mockResolvedValue(null as any) // → défauts pathology-aware
  prismaMock.patient.findFirst.mockResolvedValue({ pathology } as any)
  prismaMock.userDayMoment.findMany.mockResolvedValue([] as any) // bornes par défaut
  prismaMock.glycemiaEntry.findMany.mockResolvedValue(rows as any)
  prismaMock.auditLog.create.mockResolvedValue({} as any)
}

describe("analyticsService.bgmDailyPatternByMoment (US-2639)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("averages readings per day-moment and applies the sufficiency floor (AC-3)", async () => {
    // Matin (8h) : 3 relevés → moyenne publiée. Midi (13h) : 2 relevés → insuffisant.
    const rows = [bgm(8, 1.0), bgm(8, 1.2), bgm(8, 1.4), bgm(13, 1.6), bgm(13, 1.8)]
    setup(rows)

    const res = await analyticsService.bgmDailyPatternByMoment(42, "14d", 1, { ipAddress: "i", userAgent: "u", requestId: "r" })
    const morning = res.moments.find((m) => m.moment === "morning")!
    const noon = res.moments.find((m) => m.moment === "noon")!
    const night = res.moments.find((m) => m.moment === "night")!

    expect(morning.insufficient).toBe(false)
    expect(morning.count).toBe(3)
    expect(morning.avgMgdl).toBe(120) // (100+120+140)/3
    expect(noon.insufficient).toBe(true) // 2 < 3
    expect(noon.avgMgdl).toBeNull()
    expect(night.count).toBe(0)
    expect(night.insufficient).toBe(true)
  })

  it("exposes pathology-aware thresholds incl. severe zones (GD 63–140)", async () => {
    setup([bgm(8, 1.0), bgm(8, 1.1), bgm(8, 1.2)], "GD")
    const res = await analyticsService.bgmDailyPatternByMoment(42, "14d", 1)
    expect(res.targetRangeMgdl).toMatchObject({ low: 63, high: 140 })
    // Zones sévères pathology-aware pour la couleur (US-2641 B).
    expect(res.targetRangeMgdl.veryLow).toBeLessThan(63)
    expect(res.targetRangeMgdl.veryHigh).toBeGreaterThan(140)
  })

  it("applies GD-strict target for a pregnant patient NOT typed GD (US-2641 A)", async () => {
    prismaMock.cgmObjective.findUnique.mockResolvedValue(null as any)
    prismaMock.patient.findFirst.mockResolvedValue({ pathology: "DT1", pregnancyMode: true } as any)
    prismaMock.userDayMoment.findMany.mockResolvedValue([] as any)
    prismaMock.glycemiaEntry.findMany.mockResolvedValue([bgm(8, 1.0), bgm(8, 1.1), bgm(8, 1.2)] as any)
    prismaMock.auditLog.create.mockResolvedValue({} as any)
    const res = await analyticsService.bgmDailyPatternByMoment(42, "14d", 1)
    expect(res.targetRangeMgdl).toMatchObject({ low: 63, high: 140 }) // cibles GD malgré DT1
  })

  it("audits READ GLYCEMIA_ENTRY without any clinical value in metadata (AC-5)", async () => {
    setup([bgm(8, 1.0)])
    await analyticsService.bgmDailyPatternByMoment(42, "30d", 1, { ipAddress: "i", userAgent: "u", requestId: "r" })
    const data = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(data.resource).toBe("GLYCEMIA_ENTRY")
    expect(data.metadata).toMatchObject({ patientId: 42, kind: "bgmDailyPattern", period: "30d" })
    expect(JSON.stringify(data.metadata)).not.toMatch(/mgdl|glucose|1\.0|100/i)
  })

  it("excludes out-of-range readings and readings without a time", async () => {
    // 7.0 g/L hors plage agrégat (> 6.00) ; un relevé sans heure ignoré.
    const rows = [bgm(8, 1.0), bgm(8, 1.2), bgm(8, 7.0), { glycemiaGl: 1.5, glycemiaMgdl: null, time: null }]
    setup(rows)
    const res = await analyticsService.bgmDailyPatternByMoment(42, "14d", 1)
    const morning = res.moments.find((m) => m.moment === "morning")!
    expect(morning.count).toBe(2) // 7.0 exclu, sans-heure exclu → 2 < 3
    expect(morning.insufficient).toBe(true)
  })
})
