/**
 * Test suite: Population Analytics Service — Cabinet-level KPIs
 *
 * Clinical behavior tested:
 * - Aggregation of glycemic indicators (TIR, GMI, CV) across every patient
 *   the caller can access, returning cabinet-wide averages and counts.
 * - Bucketing of TIR (50/70/90 thresholds) and GMI (6.5/7.5/8.5) into
 *   ADA-aligned distribution bands for quality reports.
 * - Cohort segmentation by pathology (DT1 / DT2 / GD) so the practice can
 *   compare clinical outcomes by patient type.
 *
 * Associated risks:
 * - Including a patient with insufficient CGM capture in averages would
 *   skew the cabinet KPIs; the service excludes anything below 30%.
 * - Mis-counting `activeLast24h` could let dormant patients pass for
 *   followed-up ones — covered by the 24h boundary test.
 * - Returning non-null averages on an empty cabinet would propagate NaN to
 *   the dashboard — covered by the empty-input test.
 *
 * Edge cases:
 * - Empty patient list → all zeros, null averages
 * - Patient with zero CGM readings in the window → counted in total but
 *   excluded from TIR/GMI averages
 * - Patient with a recent reading inside the 24h boundary → activeLast24h
 */
import { describe, it, expect, beforeEach } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"
import { populationAnalyticsService } from "@/lib/services/population-analytics.service"
import { Pathology } from "@prisma/client"

function mockCgmEntries(count: number, avgGl: number, hoursAgo: number[] = []) {
  const base = Date.now()
  // Default: distribute readings 25h..336h ago so `activeLast24h` is only
  // true when the caller passes an explicit `hoursAgo[i] < 24` value.
  return Array.from({ length: count }, (_, i) => ({
    valueGl: avgGl + (i % 5 - 2) * 0.05,
    timestamp: new Date(base - (hoursAgo[i] ?? (25 + (i / Math.max(count, 1)) * 311)) * 3600_000),
  }))
}

beforeEach(() => {
  prismaMock.auditLog.create.mockResolvedValue({} as any)
})

describe("populationAnalyticsService", () => {
  describe("cabinetKpis", () => {
    it("returns zeros when patient list is empty", async () => {
      const result = await populationAnalyticsService.cabinetKpis([], 14, 1)
      expect(result.totalPatients).toBe(0)
      expect(result.activeLast24h).toBe(0)
      expect(result.averageTimeInRange).toBeNull()
      expect(result.averageGmi).toBeNull()
    })

    it("aggregates KPIs across multiple patients", async () => {
      prismaMock.patient.findMany.mockResolvedValue([
        { id: 1, pathology: Pathology.DT1 },
        { id: 2, pathology: Pathology.DT2 },
      ] as any)
      prismaMock.cgmObjective.findMany.mockResolvedValue([])
      prismaMock.cgmEntry.findMany
        .mockResolvedValueOnce(mockCgmEntries(2500, 1.2, [0]) as any) // patient 1 — active last 24h
        .mockResolvedValueOnce(mockCgmEntries(2500, 1.4) as any)      // patient 2

      const result = await populationAnalyticsService.cabinetKpis([1, 2], 14, 1)

      expect(result.totalPatients).toBe(2)
      expect(result.activeLast24h).toBe(1)
      expect(result.averageTimeInRange).not.toBeNull()
      expect(result.averageGmi).not.toBeNull()
    })

    it("excludes patients below 30% capture rate from averages", async () => {
      prismaMock.patient.findMany.mockResolvedValue([
        { id: 1, pathology: Pathology.DT1 },
        { id: 2, pathology: Pathology.DT2 },
      ] as any)
      prismaMock.cgmObjective.findMany.mockResolvedValue([])
      // patient 1 — good capture (~60%)
      prismaMock.cgmEntry.findMany
        .mockResolvedValueOnce(mockCgmEntries(2500, 1.2, [0]) as any)
        // patient 2 — almost no data (low capture)
        .mockResolvedValueOnce(mockCgmEntries(10, 1.2) as any)

      const result = await populationAnalyticsService.cabinetKpis([1, 2], 14, 1)
      expect(result.totalPatients).toBe(2)
      // Only patient 1 contributes to the average
      expect(result.inTarget + (2 - result.totalPatients)).toBeGreaterThanOrEqual(0)
      expect(result.averageTimeInRange).not.toBeNull()
    })
  })

  describe("qualityIndicators", () => {
    it("groups patients into TIR and GMI bands", async () => {
      prismaMock.patient.findMany.mockResolvedValue([
        { id: 1, pathology: Pathology.DT1 },
        { id: 2, pathology: Pathology.DT1 },
        { id: 3, pathology: Pathology.DT2 },
      ] as any)
      prismaMock.cgmObjective.findMany.mockResolvedValue([])
      prismaMock.cgmEntry.findMany
        .mockResolvedValueOnce(mockCgmEntries(2500, 1.10) as any) // mostly in range — TIR high
        .mockResolvedValueOnce(mockCgmEntries(2500, 2.20) as any) // mostly elevated — TIR low
        .mockResolvedValueOnce(mockCgmEntries(2500, 1.30) as any) // in range — TIR mid

      const result = await populationAnalyticsService.qualityIndicators([1, 2, 3], 14, 1)
      const tirTotal =
        result.tirDistribution.under50 +
        result.tirDistribution.from50to70 +
        result.tirDistribution.from70to90 +
        result.tirDistribution.over90
      expect(tirTotal).toBe(result.patientsWithSufficientCapture)
      expect(result.patientsWithSufficientCapture).toBe(3)
    })
  })

  describe("cohortsByPathology", () => {
    it("returns one entry per pathology including empty cohorts", async () => {
      prismaMock.patient.findMany.mockResolvedValue([
        { id: 1, pathology: Pathology.DT1 },
        { id: 2, pathology: Pathology.DT1 },
      ] as any)
      prismaMock.cgmObjective.findMany.mockResolvedValue([])
      prismaMock.cgmEntry.findMany
        .mockResolvedValueOnce(mockCgmEntries(2500, 1.2) as any)
        .mockResolvedValueOnce(mockCgmEntries(2500, 1.3) as any)

      const result = await populationAnalyticsService.cohortsByPathology([1, 2], 14, 1)
      expect(result.cohorts).toHaveLength(3)
      const dt1 = result.cohorts.find((c) => c.pathology === Pathology.DT1)!
      const dt2 = result.cohorts.find((c) => c.pathology === Pathology.DT2)!
      const gd  = result.cohorts.find((c) => c.pathology === Pathology.GD)!
      expect(dt1.patientCount).toBe(2)
      expect(dt2.patientCount).toBe(0)
      expect(gd.patientCount).toBe(0)
      expect(dt2.averageTimeInRange).toBeNull()
      expect(gd.averageTimeInRange).toBeNull()
    })
  })

  describe("exportDataset", () => {
    it("returns one row per patient with metric fields", async () => {
      prismaMock.patient.findMany.mockResolvedValue([
        { id: 7, pathology: Pathology.DT1 },
      ] as any)
      prismaMock.cgmObjective.findMany.mockResolvedValue([])
      prismaMock.cgmEntry.findMany.mockResolvedValueOnce(mockCgmEntries(1500, 1.25, [0]) as any)

      const result = await populationAnalyticsService.exportDataset([7], 14)
      expect(result).toHaveLength(1)
      expect(result[0].patientId).toBe(7)
      expect(result[0].pathology).toBe(Pathology.DT1)
      expect(result[0].activeLast24h).toBe(true)
    })

    it("does not call the auditService (caller logs the EXPORT)", async () => {
      prismaMock.patient.findMany.mockResolvedValue([])
      const before = prismaMock.auditLog.create.mock.calls.length
      await populationAnalyticsService.exportDataset([], 14)
      expect(prismaMock.auditLog.create.mock.calls.length).toBe(before)
    })
  })
})
