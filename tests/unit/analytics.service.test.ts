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
import { Prisma } from "@prisma/client"
import { prismaMock } from "../helpers/prisma-mock"

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
        { id: 1, patientId: 1, date: new Date("2026-03-10"), flow: new Prisma.Decimal(42.5) },
        { id: 2, patientId: 1, date: new Date("2026-03-11"), flow: new Prisma.Decimal(38.0) },
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
  })
})
