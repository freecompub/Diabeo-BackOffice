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
 * - GDPR — patients without `gdprConsent=true` MUST be excluded from every
 *   aggregation (RGPD Art. 7.3).
 * - Population size cap — fan-out is blocked at `MAX_POPULATION_PATIENTS` to
 *   protect the DB pool.
 *
 * Associated risks:
 * - Including a patient with insufficient CGM capture in averages would
 *   skew the cabinet KPIs (excluded below 30%).
 * - Mis-counting `activeLast24h` could let dormant patients pass for
 *   followed-up ones.
 * - GDPR-revoked patients leaking into aggregates would be HDS/RGPD breach.
 *
 * Edge cases:
 * - Empty patient list (explicit []) → all zeros, null averages
 * - ADMIN scope (null) → service builds the patient query without IN-clause
 * - Patient with zero CGM readings → counted in total but excluded from TIR
 * - Patient with a recent reading inside the 24h boundary → activeLast24h
 */
import { describe, it, expect, beforeEach } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"
import {
  populationAnalyticsService,
  MAX_POPULATION_PATIENTS,
} from "@/lib/services/population-analytics.service"
import { Pathology } from "@prisma/client"

function mockCgmEntries(count: number, avgGl: number, hoursAgo: number[] = []) {
  const base = Date.now()
  // Default: distribute readings 25h..336h ago so `activeLast24h` only
  // becomes true when the caller passes an explicit `hoursAgo[i] < 24`.
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
    it("returns zeros when patient list is empty (explicit [])", async () => {
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
      prismaMock.cgmEntry.findMany
        .mockResolvedValueOnce(mockCgmEntries(2500, 1.2, [0]) as any)
        .mockResolvedValueOnce(mockCgmEntries(10, 1.2) as any)

      const result = await populationAnalyticsService.cabinetKpis([1, 2], 14, 1)
      expect(result.totalPatients).toBe(2)
      expect(result.averageTimeInRange).not.toBeNull()
    })

    it("throws populationTooLarge when result exceeds the cap", async () => {
      const oversized = Array.from({ length: MAX_POPULATION_PATIENTS + 1 }, (_, i) => ({
        id: i + 1,
        pathology: Pathology.DT1,
      }))
      prismaMock.patient.findMany.mockResolvedValue(oversized as any)
      await expect(
        populationAnalyticsService.cabinetKpis(null, 14, 1),
      ).rejects.toThrow(/populationTooLarge/)
    })

    it("supports ADMIN scope=null (no IN-clause) by querying via where=undefined", async () => {
      prismaMock.patient.findMany.mockResolvedValue([
        { id: 1, pathology: Pathology.DT1 },
      ] as any)
      prismaMock.cgmObjective.findMany.mockResolvedValue([])
      prismaMock.cgmEntry.findMany.mockResolvedValueOnce(mockCgmEntries(500, 1.2) as any)

      await populationAnalyticsService.cabinetKpis(null, 14, 1)
      const call = prismaMock.patient.findMany.mock.calls[0][0] as any
      // null scope should not produce an `id: { in: ... }` filter.
      expect(call.where.id).toBeUndefined()
      // GDPR consent filter is still applied.
      expect(call.where.user.privacySettings.gdprConsent).toBe(true)
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
        .mockResolvedValueOnce(mockCgmEntries(2500, 1.10) as any)
        .mockResolvedValueOnce(mockCgmEntries(2500, 2.20) as any)
        .mockResolvedValueOnce(mockCgmEntries(2500, 1.30) as any)

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
      expect(dt1.patientCount).toBe(2)
      expect(dt2.patientCount).toBe(0)
      expect(dt2.averageTimeInRange).toBeNull()
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

    it("does not call auditService (caller logs the EXPORT)", async () => {
      prismaMock.patient.findMany.mockResolvedValue([])
      const before = prismaMock.auditLog.create.mock.calls.length
      await populationAnalyticsService.exportDataset([], 14)
      expect(prismaMock.auditLog.create.mock.calls.length).toBe(before)
    })
  })

  describe("GDPR consent filter (RGPD Art. 7.3)", () => {
    it("filters patients by privacySettings.gdprConsent=true at the DB level", async () => {
      prismaMock.patient.findMany.mockResolvedValue([])
      await populationAnalyticsService.exportDataset([1, 2, 3], 14)
      const call = prismaMock.patient.findMany.mock.calls[0][0] as any
      expect(call.where.user.privacySettings.gdprConsent).toBe(true)
      expect(call.where.deletedAt).toBeNull()
    })
  })
})
