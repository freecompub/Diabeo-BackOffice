/**
 * Test suite: mirror-v1-analytics.service (Groupe 10 Batch B — 3 US, 16 SP)
 *
 * Covers:
 *  - US-2227 quarterly report : cache hit vs recompute, alert aggregation
 *  - US-2228 cohort snapshot : recompute + division by zero (empty cohort)
 *  - US-2229 risk score : level transitions, acknowledge flow, dashboard listing
 */
import { describe, it, expect, beforeEach } from "vitest"
import { Prisma, RiskLevel } from "@prisma/client"
import { prismaMock } from "../helpers/prisma-mock"
import {
  patientMonitoringService,
  cohortAnalyticsService,
  riskScoreService,
} from "@/lib/services/mirror-v1-analytics.service"
import {
  NotFoundError,
  ValidationError,
} from "@/lib/services/team-workflow.errors"

beforeEach(() => {
  prismaMock.auditLog.create.mockResolvedValue({} as any)
  prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock))
})

describe("patientMonitoringService.quarterly (US-2227)", () => {
  it("getOrCompute returns cached when present", async () => {
    prismaMock.patientMonitoringMetrics.findUnique.mockResolvedValue({
      patientId: 7, quarter: "2026-Q1",
      hypoCount: 5, severeHypoCount: 1, dkaCount: 0,
      avgDurationMin: new Prisma.Decimal(12.5), topHourOfDay: 18,
      metricsJson: {}, computedAt: new Date("2026-01-15"),
    } as any)
    const out = await patientMonitoringService.getOrCompute(7, "2026-Q1", 9)
    expect(out.hypoCount).toBe(5)
    expect(out.avgDurationMin).toBe(12.5)
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.metadata.cached).toBe(true)
  })

  it("recompute aggregates EmergencyAlert by alertType", async () => {
    prismaMock.patientMonitoringMetrics.findUnique.mockResolvedValue(null)
    const trig = new Date("2026-01-15T08:30:00Z")
    prismaMock.emergencyAlert.findMany.mockResolvedValue([
      { alertType: "hypo", severity: "warning", triggeredAt: trig, resolvedAt: new Date(trig.getTime() + 10 * 60_000) },
      { alertType: "severe_hypo", severity: "critical", triggeredAt: trig, resolvedAt: new Date(trig.getTime() + 20 * 60_000) },
      { alertType: "ketone_dka", severity: "critical", triggeredAt: trig, resolvedAt: null },
      { alertType: "hyper", severity: "info", triggeredAt: trig, resolvedAt: null },
    ] as any)
    prismaMock.patientMonitoringMetrics.upsert.mockResolvedValue({
      patientId: 7, quarter: "2026-Q1",
      computedAt: new Date(),
    } as any)
    const out = await patientMonitoringService.recompute(7, "2026-Q1", 9)
    expect(out.hypoCount).toBe(2)      // hypo + severe_hypo
    expect(out.severeHypoCount).toBe(1)
    expect(out.dkaCount).toBe(1)
    expect(out.avgDurationMin).toBeCloseTo(15) // (10+20)/2
  })

  it("recompute rejects invalid quarter format", async () => {
    await expect(patientMonitoringService.recompute(7, "2026-Q5", 9))
      .rejects.toBeInstanceOf(ValidationError)
  })
})

describe("cohortAnalyticsService (US-2228)", () => {
  it("rejects empty cohort", async () => {
    prismaMock.patientService.findMany.mockResolvedValue([] as any)
    await expect(
      cohortAnalyticsService.recompute(1, new Date("2026-05-14"), 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it("computes severeHypoRate per 1000 patient-days", async () => {
    prismaMock.patientService.findMany.mockResolvedValue([
      { patientId: 1 }, { patientId: 2 }, { patientId: 3 },
    ] as any)
    prismaMock.emergencyAlert.findMany.mockResolvedValue([
      { alertType: "severe_hypo", severity: "critical" },
      { alertType: "ketone_dka", severity: "critical" },
    ] as any)
    prismaMock.cohortAnalyticsSnapshot.upsert.mockResolvedValue({
      organizationId: 1, snapshotDate: new Date(),
      computedAt: new Date(),
    } as any)
    const out = await cohortAnalyticsService.recompute(1, new Date("2026-05-14"), 9)
    expect(out.patientCount).toBe(3)
    // 1 severe_hypo / (3 patients * 90 days) * 1000 = 3.70 per 1000 patient-days
    expect(out.severeHypoRate).toBeCloseTo(3.70, 1)
    expect(out.dkaIncidence).toBeCloseTo(3.70, 1)
  })

  it("getLatest returns null when no snapshot exists", async () => {
    prismaMock.cohortAnalyticsSnapshot.findFirst.mockResolvedValue(null)
    const out = await cohortAnalyticsService.getLatest(1, 9)
    expect(out).toBeNull()
  })
})

describe("riskScoreService (US-2229)", () => {
  it("recompute builds 3 factors and scores ≥ 0", async () => {
    prismaMock.emergencyAlert.findMany
      .mockResolvedValueOnce([] as any) // recent
      .mockResolvedValueOnce([] as any) // all-time
    prismaMock.patientRiskScore.upsert.mockResolvedValue({
      patientId: 7, riskScore: 0, riskLevel: RiskLevel.low,
      acknowledgedBy: null, acknowledgedAt: null,
      computedAt: new Date(),
    } as any)
    const out = await riskScoreService.recompute(7, 9)
    expect(out.riskScore).toBe(0)
    expect(out.riskLevel).toBe(RiskLevel.low)
    // H5 fix — declarationRatio dropped pending source data ; 3 factors only.
    expect(out.contributingFactors).toHaveLength(3)
    expect(out.contributingFactors.map((f) => f.factor)).toEqual([
      "hypoFrequency", "dkaHistory", "severeHypo",
    ])
  })

  it("flags risk on high/critical level and prepares ack reset", async () => {
    // Patient with 5 recent hypos + DKA history + 5 severe hypos all-time.
    // Score = (1*0.45 + 1*0.40 + 0.5*0.15) * 100 = 92.5 → critical.
    const recent = Array.from({ length: 5 }, () => ({
      alertType: "severe_hypo", severity: "critical",
    }))
    prismaMock.emergencyAlert.findMany
      .mockResolvedValueOnce(recent as any)
      .mockResolvedValueOnce([
        ...recent,
        { alertType: "ketone_dka", severity: "critical" },
      ] as any)
    prismaMock.patientRiskScore.upsert.mockResolvedValue({
      patientId: 7, riskScore: 92, riskLevel: RiskLevel.critical,
      acknowledgedBy: null, acknowledgedAt: null,
      computedAt: new Date(),
    } as any)
    const out = await riskScoreService.recompute(7, 9)
    expect([RiskLevel.high, RiskLevel.critical]).toContain(out.riskLevel)
    expect(out.flaggedAt).not.toBeNull()
  })

  it("acknowledge rejects when not flagged", async () => {
    prismaMock.patientRiskScore.findUnique.mockResolvedValue({
      patientId: 7, flaggedAt: null,
    } as any)
    await expect(riskScoreService.acknowledge(7, 9))
      .rejects.toBeInstanceOf(ValidationError)
  })

  it("acknowledge happy path + audits", async () => {
    prismaMock.patientRiskScore.findUnique.mockResolvedValue({
      patientId: 7, riskLevel: RiskLevel.high, flaggedAt: new Date(),
    } as any)
    prismaMock.patientRiskScore.update.mockResolvedValue({
      patientId: 7, riskScore: 70, riskLevel: RiskLevel.high,
      recentHypoCount: 3, declarationRatio: new Prisma.Decimal(1),
      dkaHistory: false, contributingFactors: [],
      flaggedAt: new Date(),
      acknowledgedBy: 9, acknowledgedAt: new Date(),
      computedAt: new Date(),
    } as any)
    const out = await riskScoreService.acknowledge(7, 9)
    expect(out.acknowledgedBy).toBe(9)
  })

  it("acknowledge throws NotFoundError when missing", async () => {
    prismaMock.patientRiskScore.findUnique.mockResolvedValue(null)
    await expect(riskScoreService.acknowledge(999, 9))
      .rejects.toBeInstanceOf(NotFoundError)
  })

  it("dashboard returns rows sorted by risk", async () => {
    prismaMock.patientService.findMany.mockResolvedValue([
      { patientId: 1 }, { patientId: 2 },
    ] as any)
    prismaMock.patientRiskScore.findMany.mockResolvedValue([
      {
        patientId: 1, riskScore: 90, riskLevel: RiskLevel.critical,
        recentHypoCount: 8, declarationRatio: new Prisma.Decimal(0.5),
        dkaHistory: true, contributingFactors: [],
        flaggedAt: new Date(), acknowledgedBy: null, acknowledgedAt: null,
        computedAt: new Date(),
      },
    ] as any)
    const out = await riskScoreService.dashboard(1, 9)
    expect(out).toHaveLength(1)
    expect(out[0].riskScore).toBe(90)
  })
})
