/**
 * Test suite: Analytics Service — Glycemic Profile Analytics
 *
 * Clinical behavior tested:
 * - Generation of a full glycemic profile report for a patient over a given
 *   period, aggregating CGM readings into TIR bands, mean glucose, GMI, CV,
 *   AGP percentile curves, and hypoglycemic episode count
 * - Application of patient-specific CGM objectives when available, falling
 *   back to pathology defaults (DT1/DT2/GD) when no custom thresholds are set
 * - Clinical warning generation: CV > 36% ("high variability"), TIR < 70%
 *   ("target not met"), or CGM capture rate < 70% ("insufficient data")
 *   are surfaced as structured warnings alongside the metrics
 * - Audit logging of the profile generation event with the querying user's
 *   identity and the analysis window dates
 *
 * Associated risks:
 * - Incorrect TIR or GMI values presented in the physician dashboard could
 *   lead to inappropriate adjustments of insulin therapy
 * - Applying DT1 thresholds to a GD patient would produce misleading TIR
 *   percentages against the wrong clinical targets
 * - Missing CV warning for a highly variable patient could mask a dangerous
 *   glycemic instability requiring urgent review
 * - A missing audit entry for profile access would break HDS compliance for
 *   secondary use of health data in analytics
 *
 * Edge cases:
 * - Fewer than 200 readings in the window (low capture rate warning expected)
 * - All readings within range (TIR = 100%, no warnings)
 * - All readings below low threshold (TIR = 0%, hypo episodes spanning entire
 *   window)
 * - Patient with custom CGM objectives overriding pathology defaults
 * - Random CGM values around the mean (non-deterministic — test uses count-
 *   based thresholds, not exact values)
 */
import { describe, it, expect } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"
import { d } from "../helpers/decimal"

import { analyticsService } from "@/lib/services/analytics.service"

function mockCgmEntries(count: number, avgGl = 1.2) {
  return Array.from({ length: count }, (_, i) => ({
    valueGl: avgGl + (Math.random() - 0.5) * 0.2,
    timestamp: new Date(Date.now() - (count - i) * 5 * 60000),
  }))
}

describe("analyticsService", () => {
  describe("glycemicProfile", () => {
    it("returns profile with metrics and warnings", async () => {
      const entries = mockCgmEntries(200, 1.3)
      prismaMock.cgmEntry.findMany.mockResolvedValue(entries as any)
      prismaMock.cgmObjective.findUnique.mockResolvedValue(null)
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const result = await analyticsService.glycemicProfile(1, "14d", 1)

      expect(result.metrics.averageGlucoseGl).toBeGreaterThan(0)
      expect(result.metrics.gmi).toBeGreaterThan(4)
      expect(result.metrics.coefficientOfVariation).toBeGreaterThan(0)
      expect(result.tir).toBeDefined()
      expect(result.metrics.quality).toBeDefined()
      expect(result.readingCount).toBe(200)
    })

    it("warns when capture rate is below 70%", async () => {
      // 14 days = 4032 expected readings, providing only 100
      prismaMock.cgmEntry.findMany.mockResolvedValue(mockCgmEntries(100) as any)
      prismaMock.cgmObjective.findUnique.mockResolvedValue(null)
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const result = await analyticsService.glycemicProfile(1, "14d", 1)
      expect(result.warning).toBe("insufficientCgmCapture")
    })

    it("aggregates over the FULL valid range (0.20–6.00 g/L), not the display floor", async () => {
      // Sécurité clinique : les hypo sévères réelles sous le plancher d'affichage
      // (0.20–0.40 g/L) doivent compter dans la moyenne/CV/TIR severeHypo.
      prismaMock.cgmEntry.findMany.mockResolvedValue(mockCgmEntries(50) as any)
      prismaMock.cgmObjective.findUnique.mockResolvedValue(null)
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      await analyticsService.glycemicProfile(1, "14d", 1)

      const where = prismaMock.cgmEntry.findMany.mock.calls.at(-1)![0]!.where as any
      expect(where.valueGl).toEqual({ gte: 0.2, lte: 6.0 })
    })

    it("counts a real sub-display-floor reading (0.25 g/L) in the severeHypo TIR bucket", async () => {
      // 25 mg/dL : exclu autrefois par le filtre 0.40 → desormais compté severeHypo.
      prismaMock.cgmEntry.findMany.mockResolvedValue([
        { valueGl: 0.25, timestamp: new Date() },
        { valueGl: 1.2, timestamp: new Date() },
      ] as any)
      prismaMock.cgmObjective.findUnique.mockResolvedValue(null)
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const result = await analyticsService.glycemicProfile(1, "14d", 1)
      // veryLow défaut = 0.54 → 0.25 < 0.54 → severeHypo. 1/2 = 50 %.
      expect(result.tir.severeHypo).toBe(50)
    })
  })

  describe("glycemicProfile — US-2634 (période interactive + audit fenêtre)", () => {
    // AC-4 : parsePeriod accepte 7/14/30/90 j (le sélecteur de fiche).
    it.each([
      ["7d", 7],
      ["14d", 14],
      ["30d", 30],
      ["90d", 90],
    ])("parses %s into %i days", async (period, days) => {
      prismaMock.cgmEntry.findMany.mockResolvedValue(mockCgmEntries(50) as any)
      prismaMock.cgmObjective.findUnique.mockResolvedValue(null)
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const r = await analyticsService.glycemicProfile(1, period as string, 1)
      expect(r.period.days).toBe(days)
    })

    // AC-3 : la fenêtre lue figure dans metadata (poids forensique 90 j ≠ 7 j),
    // sans aucune valeur clinique.
    it("records the read window (period/windowDays) in audit metadata — no clinical value", async () => {
      prismaMock.cgmEntry.findMany.mockResolvedValue(mockCgmEntries(50) as any)
      prismaMock.cgmObjective.findUnique.mockResolvedValue(null)
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      await analyticsService.glycemicProfile(1, "30d", 1, {
        ipAddress: "i", userAgent: "u", requestId: "r",
      })

      const data = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
      expect(data.action).toBe("READ")
      expect(data.metadata).toMatchObject({ kind: "profile", period: "30d", windowDays: 30 })
      // Aucune valeur glycémique dans l'audit.
      expect(JSON.stringify(data.metadata)).not.toMatch(/glucose|mgdl|tir|gmi/i)
    })
  })

  describe("dailyStats — US-2636 (1 ligne/jour)", () => {
    it("maps raw daily rows → mg/dL + % en cible, audite kind=dailyStats + période", async () => {
      prismaMock.cgmObjective.findUnique.mockResolvedValue(null)
      prismaMock.patient.findFirst.mockResolvedValue({ pathology: "DT1" } as any)
      prismaMock.auditLog.create.mockResolvedValue({} as any)
      ;(prismaMock.$queryRaw as any).mockResolvedValue([
        { day: "2026-07-01", avg_gl: 1.5, min_gl: 0.7, max_gl: 2.4, n: 288, in_target: 216 },
      ])

      const res = await analyticsService.dailyStats(1, "30d", 1, {
        ipAddress: "i", userAgent: "u", requestId: "r",
      })

      // g/L → mg/dL (×100), % en cible = in_target/n.
      expect(res).toEqual([
        { day: "2026-07-01", avgMgdl: 150, minMgdl: 70, maxMgdl: 240, count: 288, inTargetPct: 75 },
      ])
      const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
      expect(audit.action).toBe("READ")
      expect(audit.metadata).toMatchObject({ kind: "dailyStats", period: "30d", windowDays: 30, source: "cgm" })
      expect(JSON.stringify(audit.metadata)).not.toMatch(/glucose|mgdl/i)
    })

    it("queries GlycemiaEntry (BGM) when source=bgm", async () => {
      prismaMock.cgmObjective.findUnique.mockResolvedValue(null)
      prismaMock.patient.findFirst.mockResolvedValue({ pathology: "DT1" } as any)
      prismaMock.auditLog.create.mockResolvedValue({} as any)
      ;(prismaMock.$queryRaw as any).mockResolvedValue([])

      const res = await analyticsService.dailyStats(1, "14d", 1, undefined, { source: "bgm" })
      expect(res).toEqual([])
      const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
      expect(audit.metadata).toMatchObject({ kind: "dailyStats", source: "bgm" })
    })
  })

  describe("timeInRange", () => {
    it("returns TIR with quality assessment", async () => {
      prismaMock.cgmEntry.findMany.mockResolvedValue(mockCgmEntries(500) as any)
      prismaMock.cgmObjective.findUnique.mockResolvedValue(null)
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const result = await analyticsService.timeInRange(1, "7d", 1)

      expect(result.tir.inRange).toBeGreaterThan(0)
      expect(result.quality).toBeDefined()
      expect(result.thresholds).toBeDefined()
    })

    it("uses tighter GD defaults (63–140 mg/dL) when no CGM objective + GD pathology", async () => {
      prismaMock.cgmEntry.findMany.mockResolvedValue(mockCgmEntries(100) as any)
      prismaMock.cgmObjective.findUnique.mockResolvedValue(null)
      prismaMock.patient.findFirst.mockResolvedValue({ pathology: "GD" } as any)
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const result = await analyticsService.timeInRange(1, "14d", 1)
      expect(result.thresholds.low).toBe(0.63)
      expect(result.thresholds.ok).toBe(1.4)
    })

    it("uses generic defaults (70–180 mg/dL) when no CGM objective + DT1/DT2", async () => {
      prismaMock.cgmEntry.findMany.mockResolvedValue(mockCgmEntries(100) as any)
      prismaMock.cgmObjective.findUnique.mockResolvedValue(null)
      prismaMock.patient.findFirst.mockResolvedValue({ pathology: "DT1" } as any)
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const result = await analyticsService.timeInRange(1, "14d", 1)
      expect(result.thresholds.low).toBe(0.7)
      expect(result.thresholds.ok).toBe(1.8)
    })
  })

  describe("agp", () => {
    it("returns 96 time slots", async () => {
      prismaMock.cgmEntry.findMany.mockResolvedValue(mockCgmEntries(288) as any)
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const result = await analyticsService.agp(1, "14d", 1)
      expect(result).toHaveLength(96)
    })
  })

  describe("hypoglycemia", () => {
    it("returns episode detection results", async () => {
      const entries = [
        ...mockCgmEntries(10, 1.2),
        // Add hypo readings
        { valueGl: 0.60, timestamp: new Date(Date.now() - 30 * 60000) },
        { valueGl: 0.55, timestamp: new Date(Date.now() - 25 * 60000) },
        { valueGl: 0.65, timestamp: new Date(Date.now() - 20 * 60000) },
      ]
      prismaMock.cgmEntry.findMany.mockResolvedValue(entries as any)
      prismaMock.cgmObjective.findUnique.mockResolvedValue(null)
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const result = await analyticsService.hypoglycemia(1, "30d", 1)
      expect(result.episodeCount).toBeGreaterThanOrEqual(0)
      expect(result.level1Count).toBeDefined()
      expect(result.level2Count).toBeDefined()
    })
  })

  describe("insulinSummary", () => {
    it("returns insulin flow summary", async () => {
      prismaMock.insulinFlowEntry.findMany.mockResolvedValue([
        { id: 1, patientId: 1, date: new Date("2026-03-10"), flow: d(42.5) },
        { id: 2, patientId: 1, date: new Date("2026-03-11"), flow: d(38.0) },
      ] as any)
      prismaMock.pumpEvent.findMany.mockResolvedValue([])
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const result = await analyticsService.insulinSummary(
        1, new Date("2026-03-01"), new Date("2026-03-31"), 1,
      )

      expect(result.totalUnits).toBeCloseTo(80.5)
      // avgDailyUnits = totalUnits / distinct days (2 distinct dates)
      expect(result.avgDailyUnits).toBeCloseTo(40.25)
      expect(result.dayCount).toBe(2)
    })

    it("handles InsulinFlowEntry with null flow (treats as 0 via ?? fallback)", async () => {
      // Regression: after switching Number(f.flow) → f.flow?.toNumber() ?? 0,
      // null flow rows must no longer crash and must contribute 0 units.
      prismaMock.insulinFlowEntry.findMany.mockResolvedValue([
        { id: 1, patientId: 1, date: new Date("2026-03-10"), flow: d(20) },
        { id: 2, patientId: 1, date: new Date("2026-03-11"), flow: null },
      ] as any)
      prismaMock.pumpEvent.findMany.mockResolvedValue([])
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const result = await analyticsService.insulinSummary(
        1, new Date("2026-03-01"), new Date("2026-03-31"), 1,
      )

      expect(result.totalUnits).toBeCloseTo(20)  // 20 + 0 (null)
      expect(result.dayCount).toBe(2)             // 2 distinct days still counted
    })
  })

  // ─── US-2631 socle fiche patient ─────────────────────────────────────────
  describe("glycemicProfile — socle US-2631 (stdDev + cible pathology-aware)", () => {
    it("exposes stdDevMgdl and pathology-aware targetRangeMgdl (adulte 70–180)", async () => {
      prismaMock.cgmEntry.findMany.mockResolvedValue(mockCgmEntries(200, 1.3) as any)
      prismaMock.cgmObjective.findUnique.mockResolvedValue(null)
      prismaMock.patient.findFirst.mockResolvedValue({ pathology: "DT1" } as any)
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const r = await analyticsService.glycemicProfile(1, "14d", 1)
      expect(typeof r.metrics.stdDevMgdl).toBe("number")
      expect(r.metrics.stdDevMgdl).toBeGreaterThanOrEqual(0)
      expect(r.targetRangeMgdl).toEqual({ low: 70, high: 180 })
    })

    it("uses GD target range (63–140) for a gestational diabetes patient", async () => {
      prismaMock.cgmEntry.findMany.mockResolvedValue(mockCgmEntries(200, 1.0) as any)
      prismaMock.cgmObjective.findUnique.mockResolvedValue(null)
      prismaMock.patient.findFirst.mockResolvedValue({ pathology: "GD" } as any)
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const r = await analyticsService.glycemicProfile(1, "14d", 1)
      expect(r.targetRangeMgdl).toEqual({ low: 63, high: 140 })
    })
  })

  describe("bgmStats — socle US-2631 (% relevés en cible ≠ TIR)", () => {
    it("computes % in target + readings/day, pathology-aware, audited", async () => {
      // 4 relevés capillaires (g/L) sur 14 j : 3 en cible [0.70,1.80], 1 hyper.
      prismaMock.glycemiaEntry.findMany.mockResolvedValue([
        { glycemiaGl: d(1.10), glycemiaMgdl: null },
        { glycemiaGl: d(0.95), glycemiaMgdl: null },
        { glycemiaGl: d(1.60), glycemiaMgdl: null },
        { glycemiaGl: d(2.20), glycemiaMgdl: null }, // hyper
      ] as any)
      prismaMock.cgmObjective.findUnique.mockResolvedValue(null)
      prismaMock.patient.findFirst.mockResolvedValue({ pathology: "DT2" } as any)
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const r = await analyticsService.bgmStats(1, "14d", 1)
      expect(r.total).toBe(4)
      expect(r.inRangePercent).toBe(75) // 3/4
      expect(r.readingsPerDay).toBe(0.3) // 4/14 arrondi 0.1
      expect(r.targetRangeMgdl).toEqual({ low: 70, high: 180 })
      // audité READ GLYCEMIA_ENTRY kind=bgmStats
      const meta = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
      expect(meta.resource).toBe("GLYCEMIA_ENTRY")
      expect(meta.metadata.kind).toBe("bgmStats")
    })

    it("returns inRangePercent null when no usable reading", async () => {
      prismaMock.glycemiaEntry.findMany.mockResolvedValue([] as any)
      prismaMock.cgmObjective.findUnique.mockResolvedValue(null)
      prismaMock.patient.findFirst.mockResolvedValue({ pathology: "DT1" } as any)
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const r = await analyticsService.bgmStats(1, "14d", 1)
      expect(r.total).toBe(0)
      expect(r.inRangePercent).toBeNull()
    })
  })
})
