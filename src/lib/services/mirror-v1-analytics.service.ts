/**
 * @module mirror-v1-analytics.service
 * @description Groupe 10 Mirror V1 Batch B (3 US, ~16 SP).
 *
 *  - US-2227 quarterlyReport — per-patient emergency event aggregation
 *  - US-2228 cohortSnapshot  — cabinet-wide KPIs vs national benchmark
 *  - US-2229 riskScore       — rule-based 0-100 score with explainable factors
 *
 * Reads exclusively from `EmergencyAlert` (Mirror MVP, PR #343) — no schema
 * change to the alert pipeline. Writes go to caches : PatientMonitoringMetrics,
 * CohortAnalyticsSnapshot, PatientRiskScore.
 *
 * Risk score : rule-based (NOT ML). Factors :
 *  - hypoFrequency : count(hypo|severeHypo) in past 7 days  (weight 0.35)
 *  - declarationRatio : reported hypos / detected hypos     (weight 0.25)
 *  - dkaHistory : any past DKA episode                       (weight 0.30)
 *  - severeHypoCount : count(severeHypo) all-time            (weight 0.10)
 * Score = min(100, sum(factor * weight * 100)). Level :
 *   <30 low ; <60 medium ; <85 high ; ≥85 critical.
 */

import { Prisma, RiskLevel } from "@prisma/client"
import { prisma, type PrismaClientOrTx as Tx } from "@/lib/db/client"
import { auditService, type AuditContext } from "./audit.service"
import { NotFoundError, ValidationError } from "./team-workflow.errors"

const QUARTER_RE = /^[0-9]{4}-Q[1-4]$/

function parseQuarter(quarter: string): { start: Date; end: Date } {
  if (!QUARTER_RE.test(quarter)) throw new ValidationError("quarter")
  const year = parseInt(quarter.slice(0, 4), 10)
  const q = parseInt(quarter.slice(6), 10)
  const startMonth = (q - 1) * 3
  return {
    start: new Date(Date.UTC(year, startMonth, 1)),
    end: new Date(Date.UTC(year, startMonth + 3, 1)),
  }
}

// ─────────────────────────────────────────────────────────────
// US-2227 — Quarterly report per patient
// ─────────────────────────────────────────────────────────────

export type QuarterlyReportDTO = {
  patientId: number
  quarter: string
  hypoCount: number
  severeHypoCount: number
  dkaCount: number
  avgDurationMin: number | null
  topHourOfDay: number | null
  computedAt: Date
}

export const patientMonitoringService = {
  async getOrCompute(
    patientId: number, quarter: string,
    auditUserId: number, ctx?: AuditContext,
  ): Promise<QuarterlyReportDTO> {
    const cached = await prisma.patientMonitoringMetrics.findUnique({
      where: { patientId_quarter: { patientId, quarter } },
    })
    if (cached) {
      await auditService.log({
        userId: auditUserId, action: "READ", resource: "PATIENT_MONITORING_METRICS",
        resourceId: String(patientId),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { patientId, kind: "quarterly.read", quarter, cached: true },
      })
      return {
        patientId: cached.patientId, quarter: cached.quarter,
        hypoCount: cached.hypoCount, severeHypoCount: cached.severeHypoCount,
        dkaCount: cached.dkaCount,
        avgDurationMin: cached.avgDurationMin?.toNumber() ?? null,
        topHourOfDay: cached.topHourOfDay,
        computedAt: cached.computedAt,
      }
    }
    return this.recompute(patientId, quarter, auditUserId, ctx)
  },

  async recompute(
    patientId: number, quarter: string,
    auditUserId: number, ctx?: AuditContext,
  ): Promise<QuarterlyReportDTO> {
    const { start, end } = parseQuarter(quarter)
    return prisma.$transaction(async (tx: Tx) => {
      const alerts = await tx.emergencyAlert.findMany({
        where: {
          patientId,
          triggeredAt: { gte: start, lt: end },
        },
        select: {
          alertType: true, severity: true, triggeredAt: true,
          resolvedAt: true,
        },
      })
      const hypoCount = alerts.filter(
        (a) => a.alertType === "hypo" || a.alertType === "severe_hypo",
      ).length
      const severeHypoCount = alerts.filter(
        (a) => a.alertType === "severe_hypo",
      ).length
      const dkaCount = alerts.filter((a) => a.alertType === "ketone_dka").length

      // Average duration in minutes for resolved alerts.
      const durations: number[] = alerts
        .filter((a) => a.resolvedAt !== null)
        .map((a) => (a.resolvedAt!.getTime() - a.triggeredAt.getTime()) / 60_000)
      const avgDurationMin = durations.length > 0
        ? durations.reduce((a, b) => a + b, 0) / durations.length
        : null

      // Most common hour-of-day for hypo events.
      const hourCounts = new Map<number, number>()
      for (const a of alerts) {
        const h = a.triggeredAt.getUTCHours()
        hourCounts.set(h, (hourCounts.get(h) ?? 0) + 1)
      }
      let topHourOfDay: number | null = null
      let max = 0
      for (const [hour, count] of hourCounts) {
        if (count > max) { max = count; topHourOfDay = hour }
      }

      const upserted = await tx.patientMonitoringMetrics.upsert({
        where: { patientId_quarter: { patientId, quarter } },
        create: {
          patientId, quarter,
          hypoCount, severeHypoCount, dkaCount,
          avgDurationMin: avgDurationMin !== null ? new Prisma.Decimal(avgDurationMin.toFixed(1)) : null,
          topHourOfDay,
          metricsJson: {
            totalAlerts: alerts.length,
            hourDistribution: Object.fromEntries(hourCounts),
          },
        },
        update: {
          hypoCount, severeHypoCount, dkaCount,
          avgDurationMin: avgDurationMin !== null ? new Prisma.Decimal(avgDurationMin.toFixed(1)) : null,
          topHourOfDay,
          metricsJson: {
            totalAlerts: alerts.length,
            hourDistribution: Object.fromEntries(hourCounts),
          },
          computedAt: new Date(),
        },
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "UPDATE", resource: "PATIENT_MONITORING_METRICS",
        resourceId: String(patientId),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { patientId, kind: "quarterly.recompute", quarter, alertCount: alerts.length },
      })
      return {
        patientId: upserted.patientId, quarter: upserted.quarter,
        hypoCount, severeHypoCount, dkaCount,
        avgDurationMin,
        topHourOfDay,
        computedAt: upserted.computedAt,
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },
}

// ─────────────────────────────────────────────────────────────
// US-2228 — Cohort analytics snapshot
// ─────────────────────────────────────────────────────────────

export type CohortAnalyticsDTO = {
  organizationId: number
  snapshotDate: Date
  patientCount: number
  severeHypoRate: number
  dkaIncidence: number
  nationalBenchmark: unknown
  computedAt: Date
}

/**
 * M5 (re-review) — Placeholder benchmark NOT vetted by ANSM/SFD. Source field
 * lets the UI render an appropriate disclaimer ("source: placeholder").
 * Replace with monthly-updated dataset before launching the comparison line
 * in the DOCTOR dashboard.
 */
const NATIONAL_BENCHMARK = {
  severeHypoRate: 8.5, // per 1000 patient-days
  dkaIncidence: 1.2,   // per 1000 patient-days
  source: "placeholder-not-vetted" as const,
  // M2-NEW (re-review) — server-controlled disclaimer string the UI cannot
  //   strip. If a client renders the rate without rendering the disclaimer,
  //   that's a downstream a11y/safety bug ; the server's contract is fulfilled.
  disclaimer:
    "Données de référence indicatives — non validées par ANSM/SFD."
    + " Ne pas utiliser comme seuil clinique.",
}

export const cohortAnalyticsService = {
  async getLatest(organizationId: number, auditUserId: number, ctx?: AuditContext): Promise<CohortAnalyticsDTO | null> {
    const row = await prisma.cohortAnalyticsSnapshot.findFirst({
      where: { organizationId },
      orderBy: { snapshotDate: "desc" },
    })
    await auditService.log({
      userId: auditUserId, action: "READ", resource: "COHORT_ANALYTICS",
      resourceId: String(organizationId),
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { organizationId, kind: "snapshot.latest" },
    })
    return row ? {
      organizationId: row.organizationId,
      snapshotDate: row.snapshotDate,
      patientCount: row.patientCount,
      severeHypoRate: row.severeHypoRate.toNumber(),
      dkaIncidence: row.dkaIncidence.toNumber(),
      nationalBenchmark: row.nationalBenchmark,
      computedAt: row.computedAt,
    } : null
  },

  async recompute(
    organizationId: number, snapshotDate: Date,
    auditUserId: number, ctx?: AuditContext,
  ): Promise<CohortAnalyticsDTO> {
    const lookbackDays = 90
    const lookbackStart = new Date(snapshotDate.getTime() - lookbackDays * 86_400_000)

    return prisma.$transaction(async (tx: Tx) => {
      const patientIds = await tx.patientService.findMany({
        where: { serviceId: organizationId },
        select: { patientId: true },
      })
      const patientCount = patientIds.length
      const patientDays = patientCount * lookbackDays
      if (patientCount === 0) {
        throw new ValidationError("emptyCohort")
      }

      const ids = patientIds.map((p) => p.patientId)
      const alerts = await tx.emergencyAlert.findMany({
        where: {
          patientId: { in: ids },
          triggeredAt: { gte: lookbackStart, lt: snapshotDate },
        },
        select: { alertType: true, severity: true },
      })
      const severeHypoEvents = alerts.filter(
        (a) => a.alertType === "severe_hypo",
      ).length
      const dkaEvents = alerts.filter((a) => a.alertType === "ketone_dka").length

      const severeHypoRate = (severeHypoEvents / patientDays) * 1000
      const dkaIncidence = (dkaEvents / patientDays) * 1000

      const upserted = await tx.cohortAnalyticsSnapshot.upsert({
        where: { organizationId_snapshotDate: { organizationId, snapshotDate } },
        create: {
          organizationId, snapshotDate,
          patientCount,
          severeHypoRate: new Prisma.Decimal(severeHypoRate.toFixed(2)),
          dkaIncidence: new Prisma.Decimal(dkaIncidence.toFixed(2)),
          nationalBenchmark: NATIONAL_BENCHMARK,
          stratification: {
            lookbackDays,
            totalAlerts: alerts.length,
          },
        },
        update: {
          patientCount,
          severeHypoRate: new Prisma.Decimal(severeHypoRate.toFixed(2)),
          dkaIncidence: new Prisma.Decimal(dkaIncidence.toFixed(2)),
          nationalBenchmark: NATIONAL_BENCHMARK,
          stratification: { lookbackDays, totalAlerts: alerts.length },
          computedAt: new Date(),
        },
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "UPDATE", resource: "COHORT_ANALYTICS",
        resourceId: String(organizationId),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        // H7 (re-review) — drop raw rates from audit metadata. The snapshot row
        // already carries them; duplicating into audit_logs persists clinical
        // KPIs in immutable storage for 6 years without need.
        metadata: { organizationId, kind: "snapshot.recompute", patientCount },
      })
      return {
        organizationId: upserted.organizationId,
        snapshotDate: upserted.snapshotDate,
        patientCount, severeHypoRate, dkaIncidence,
        nationalBenchmark: NATIONAL_BENCHMARK,
        computedAt: upserted.computedAt,
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },
}

// ─────────────────────────────────────────────────────────────
// US-2229 — Patient risk score (rule-based, explainable)
// ─────────────────────────────────────────────────────────────

export type RiskScoreDTO = {
  patientId: number
  riskScore: number
  riskLevel: RiskLevel
  recentHypoCount: number
  /** M1-NEW (re-review) — `declarationRatio` removed from public DTO until
   *  the EmergencyAlert.source field lands. Returning a placeholder 1.0
   *  was misleading clinicians ("100% self-reporting" green signal). */
  dkaHistory: boolean
  contributingFactors: { factor: string; weight: number; value: number; contribution: number }[]
  flaggedAt: Date | null
  acknowledgedBy: number | null
  acknowledgedAt: Date | null
  computedAt: Date
}

/**
 * H5 (re-review) — `declarationRatio` (self-reported vs detected hypos) needs
 * a `source` field on EmergencyAlert that doesn't exist yet (TODO Batch C).
 * Until that data lands, drop the factor and renormalise the 3 remaining
 * weights to sum to 1.0 so scores can still reach 100.
 *
 * Weights chosen so a patient with frequent hypos AND a DKA history hits HIGH
 * (≥ 60). Re-calibration to be validated by `medical-domain-validator` when
 * the declaration source is wired up.
 */
const RISK_WEIGHTS = {
  hypoFrequency: 0.45,
  dkaHistory: 0.40,
  severeHypo: 0.15,
} as const

function levelFromScore(score: number): RiskLevel {
  if (score >= 85) return RiskLevel.critical
  if (score >= 60) return RiskLevel.high
  if (score >= 30) return RiskLevel.medium
  return RiskLevel.low
}

export const riskScoreService = {
  async getByPatient(
    patientId: number, auditUserId: number, ctx?: AuditContext,
  ): Promise<RiskScoreDTO | null> {
    const row = await prisma.patientRiskScore.findUnique({ where: { patientId } })
    if (!row) return null
    await auditService.log({
      userId: auditUserId, action: "READ", resource: "PATIENT_RISK_SCORE",
      resourceId: String(patientId),
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { patientId, kind: "score.read" },
    })
    return {
      patientId: row.patientId, riskScore: row.riskScore,
      riskLevel: row.riskLevel,
      recentHypoCount: row.recentHypoCount,
      dkaHistory: row.dkaHistory,
      contributingFactors: row.contributingFactors as RiskScoreDTO["contributingFactors"],
      flaggedAt: row.flaggedAt,
      acknowledgedBy: row.acknowledgedBy,
      acknowledgedAt: row.acknowledgedAt,
      computedAt: row.computedAt,
    }
  },

  async recompute(
    patientId: number, auditUserId: number, ctx?: AuditContext,
  ): Promise<RiskScoreDTO> {
    const SEVEN_DAYS_AGO = new Date(Date.now() - 7 * 86_400_000)
    // C5 (re-review) — bound the "all-time" lookback to 2 years to avoid
    //  loading thousands of rows for long-lived patients (OOM risk).
    const TWO_YEARS_AGO = new Date(Date.now() - 730 * 86_400_000)
    return prisma.$transaction(async (tx: Tx) => {
      const [recentAlerts, allAlerts] = await Promise.all([
        tx.emergencyAlert.findMany({
          where: {
            patientId,
            triggeredAt: { gte: SEVEN_DAYS_AGO },
          },
          select: { alertType: true, severity: true },
          take: 500,
        }),
        tx.emergencyAlert.findMany({
          where: {
            patientId,
            triggeredAt: { gte: TWO_YEARS_AGO },
          },
          select: { alertType: true, severity: true },
          take: 5000,
        }),
      ])

      const recentHypoCount = recentAlerts.filter(
        (a) => a.alertType === "hypo" || a.alertType === "severe_hypo",
      ).length
      const dkaHistory = allAlerts.some((a) => a.alertType === "ketone_dka")
      const allTimeSevere = allAlerts.filter(
        (a) => a.alertType === "severe_hypo",
      ).length

      // Each factor contributes (value normalised to [0,1]) * weight * 100.
      const factors: RiskScoreDTO["contributingFactors"] = [
        {
          factor: "hypoFrequency",
          weight: RISK_WEIGHTS.hypoFrequency,
          value: Math.min(recentHypoCount / 5, 1),
          contribution: Math.min(recentHypoCount / 5, 1) * RISK_WEIGHTS.hypoFrequency * 100,
        },
        {
          factor: "dkaHistory",
          weight: RISK_WEIGHTS.dkaHistory,
          value: dkaHistory ? 1 : 0,
          contribution: (dkaHistory ? 1 : 0) * RISK_WEIGHTS.dkaHistory * 100,
        },
        {
          factor: "severeHypo",
          weight: RISK_WEIGHTS.severeHypo,
          value: Math.min(allTimeSevere / 10, 1),
          contribution: Math.min(allTimeSevere / 10, 1) * RISK_WEIGHTS.severeHypo * 100,
        },
      ]
      const score = Math.min(100, Math.round(
        factors.reduce((acc, f) => acc + f.contribution, 0),
      ))
      const level = levelFromScore(score)
      const flaggedAt = (level === RiskLevel.high || level === RiskLevel.critical)
        ? new Date() : null

      const upserted = await tx.patientRiskScore.upsert({
        where: { patientId },
        create: {
          patientId,
          riskScore: score, riskLevel: level,
          recentHypoCount,
          // H5 — placeholder (1.0 = neutral). Field is kept on the schema for
          // future use once EmergencyAlert exposes the report source.
          declarationRatio: new Prisma.Decimal("1.00"),
          dkaHistory,
          contributingFactors: factors satisfies Prisma.InputJsonValue,
          flaggedAt,
        },
        update: {
          riskScore: score, riskLevel: level,
          recentHypoCount,
          declarationRatio: new Prisma.Decimal("1.00"),
          dkaHistory,
          contributingFactors: factors satisfies Prisma.InputJsonValue,
          flaggedAt,
          // H3-NEW (re-review) — always reset acknowledgement on recompute.
          //   Acks are tied to a specific score snapshot ; once recompute runs
          //   the prior ack is no longer meaningful (level may have dropped or
          //   risen). A new ack is required on any flagged level.
          acknowledgedBy: null, acknowledgedAt: null,
          computedAt: new Date(),
        },
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "UPDATE", resource: "PATIENT_RISK_SCORE",
        resourceId: String(patientId),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        // H7 (re-review) — score/level are stored in the table, no need to
        // duplicate into audit_logs (clinical judgment retained 6 years).
        metadata: { patientId, kind: "score.recompute" },
      })
      return {
        patientId: upserted.patientId, riskScore: score, riskLevel: level,
        recentHypoCount, dkaHistory,
        contributingFactors: factors,
        flaggedAt,
        // M12 (re-review) — read from upserted row (may differ on update branch).
        acknowledgedBy: upserted.acknowledgedBy,
        acknowledgedAt: upserted.acknowledgedAt,
        computedAt: upserted.computedAt,
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },

  async acknowledge(
    patientId: number, auditUserId: number, ctx?: AuditContext,
  ): Promise<RiskScoreDTO> {
    return prisma.$transaction(async (tx: Tx) => {
      const row = await tx.patientRiskScore.findUnique({ where: { patientId } })
      if (!row) throw new NotFoundError()
      if (row.flaggedAt === null) throw new ValidationError("notFlagged")
      const updated = await tx.patientRiskScore.update({
        where: { patientId },
        data: { acknowledgedBy: auditUserId, acknowledgedAt: new Date() },
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "UPDATE", resource: "PATIENT_RISK_SCORE",
        resourceId: String(patientId),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { patientId, kind: "score.acknowledge", riskLevel: row.riskLevel },
      })
      return {
        patientId: updated.patientId, riskScore: updated.riskScore, riskLevel: updated.riskLevel,
        recentHypoCount: updated.recentHypoCount,
        dkaHistory: updated.dkaHistory,
        contributingFactors: updated.contributingFactors as RiskScoreDTO["contributingFactors"],
        flaggedAt: updated.flaggedAt,
        acknowledgedBy: updated.acknowledgedBy,
        acknowledgedAt: updated.acknowledgedAt,
        computedAt: updated.computedAt,
      }
    })
  },

  async dashboard(
    organizationId: number, auditUserId: number, ctx?: AuditContext,
  ): Promise<RiskScoreDTO[]> {
    const links = await prisma.patientService.findMany({
      where: { serviceId: organizationId },
      select: { patientId: true },
    })
    const rows = await prisma.patientRiskScore.findMany({
      where: { patientId: { in: links.map((l) => l.patientId) } },
      orderBy: [{ riskLevel: "desc" }, { riskScore: "desc" }, { computedAt: "desc" }],
      take: 200,
    })
    // C2-NEW (re-review) — emit ONE audit row per patient so the existing
    //   US-2268 GIN partial index on `metadata->'patientId'` (scalar)
    //   surfaces the dashboard read in `getByPatient(X)`. Plural `patientIds`
    //   array would NOT be covered by that index.
    // Parent row for the organization-level event :
    await auditService.log({
      userId: auditUserId, action: "READ", resource: "PATIENT_RISK_SCORE",
      resourceId: String(organizationId),
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { organizationId, kind: "dashboard.list", count: rows.length },
    })
    // Per-patient pivot rows for forensics (capped at 200 by `take`).
    await Promise.all(rows.map((r) => auditService.log({
      userId: auditUserId, action: "READ", resource: "PATIENT_RISK_SCORE",
      resourceId: String(r.patientId),
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { patientId: r.patientId, kind: "dashboard.read", organizationId },
    })))
    return rows.map((r) => ({
      patientId: r.patientId, riskScore: r.riskScore, riskLevel: r.riskLevel,
      recentHypoCount: r.recentHypoCount,
      dkaHistory: r.dkaHistory,
      contributingFactors: r.contributingFactors as RiskScoreDTO["contributingFactors"],
      flaggedAt: r.flaggedAt,
      acknowledgedBy: r.acknowledgedBy, acknowledgedAt: r.acknowledgedAt,
      computedAt: r.computedAt,
    }))
  },
}
