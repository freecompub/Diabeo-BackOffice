/**
 * @module population-analytics.service
 * @description Cabinet-level (population) analytics — aggregated KPIs across
 * all patients the caller can access. Used by dashboards and quality reports.
 *
 * Scope:
 * - US-2094 — Tableau de bord population (cabinet KPIs)
 * - US-2095 — Indicateurs qualité (TIR/GMI distributions)
 * - US-2096 — Cohorte par pathologie (breakdown DT1/DT2/GD)
 * - US-2098 — Export CSV (population dataset)
 *
 * Access control: relies on `getAccessiblePatientIds` for RBAC scoping.
 * ADMIN sees the whole cabinet; DOCTOR/NURSE only their PatientService links;
 * VIEWER (patient) is filtered out earlier — population analytics is pro-only.
 *
 * Performance: computes TIR/GMI per patient by streaming CGM rows. The 30-day
 * window keeps the worst-case dataset under ~500 patients × 8640 readings
 * (≈4.3M rows). For larger cabinets the caller should cache (Redis 5 min).
 */

import { Pathology } from "@prisma/client"
import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import {
  mean,
  glToMgdl,
  glucoseManagementIndicator,
  coefficientOfVariation,
  computeTir,
  cgmCaptureRate,
  type CgmThresholds,
  type TirResult,
} from "@/lib/statistics"
import type { AuditContext } from "./patient.service"

/** Default CGM thresholds in g/L if patient has no CgmObjective row. */
const DEFAULT_THRESHOLDS: CgmThresholds = {
  veryLow: 0.54,
  low: 0.70,
  ok: 1.80,
  high: 2.50,
}
/** Capture-rate threshold below which the patient is excluded from population metrics. */
const MIN_CAPTURE_RATE = 30
/** Default analytics window for population metrics — bounded for perf. */
const DEFAULT_WINDOW_DAYS = 14
const MAX_WINDOW_DAYS = 30

export type PopulationPatientMetric = {
  patientId: number
  pathology: Pathology
  readingCount: number
  captureRate: number
  averageGlucoseMgdl: number | null
  gmi: number | null
  coefficientOfVariation: number | null
  tir: TirResult | null
  /** True if patient has at least one CGM reading in the last 24h. */
  activeLast24h: boolean
}

export type PopulationKpi = {
  windowDays: number
  totalPatients: number
  activeLast24h: number
  /** Patients with TIR ≥ 70% over the window. */
  inTarget: number
  /** Patients with at least one severeLow (level2) zone reading in the window. */
  criticalHypoCount: number
  /** Mean TIR (% in range) across patients with sufficient capture. */
  averageTimeInRange: number | null
  /** Mean GMI across patients with sufficient capture. */
  averageGmi: number | null
}

export type QualityIndicators = {
  windowDays: number
  tirDistribution: Record<"under50" | "from50to70" | "from70to90" | "over90", number>
  gmiDistribution: Record<"under65" | "from65to75" | "from75to85" | "over85", number>
  patientsWithSufficientCapture: number
  patientsExcluded: number
}

export type CohortBreakdown = {
  windowDays: number
  cohorts: Array<{
    pathology: Pathology
    patientCount: number
    averageTimeInRange: number | null
    averageGmi: number | null
    activeLast24h: number
  }>
}

function clampWindow(days: number | undefined): number {
  if (!days || days <= 0) return DEFAULT_WINDOW_DAYS
  if (days > MAX_WINDOW_DAYS) return MAX_WINDOW_DAYS
  return Math.floor(days)
}

async function loadThresholds(patientIds: number[]): Promise<Map<number, CgmThresholds>> {
  if (patientIds.length === 0) return new Map()
  const rows = await prisma.cgmObjective.findMany({
    where: { patientId: { in: patientIds } },
    select: {
      patientId: true,
      veryLow: true,
      low: true,
      ok: true,
      high: true,
    },
  })
  const map = new Map<number, CgmThresholds>()
  for (const r of rows) {
    map.set(r.patientId, {
      veryLow: Number(r.veryLow),
      low: Number(r.low),
      ok: Number(r.ok),
      high: Number(r.high),
    })
  }
  return map
}

async function computePatientMetric(
  patientId: number,
  pathology: Pathology,
  from: Date,
  to: Date,
  windowDays: number,
  thresholds: CgmThresholds,
  twentyFourHoursAgo: Date,
): Promise<PopulationPatientMetric> {
  const entries = await prisma.cgmEntry.findMany({
    where: {
      patientId,
      timestamp: { gte: from, lte: to },
      valueGl: { gte: 0.40, lte: 5.00 },
    },
    orderBy: { timestamp: "asc" },
    select: { valueGl: true, timestamp: true },
  })

  const values = entries.map((e) => Number(e.valueGl))
  const captureRate = cgmCaptureRate(entries.length, windowDays)
  const activeLast24h = entries.some((e) => e.timestamp >= twentyFourHoursAgo)

  if (entries.length === 0) {
    return {
      patientId,
      pathology,
      readingCount: 0,
      captureRate: 0,
      averageGlucoseMgdl: null,
      gmi: null,
      coefficientOfVariation: null,
      tir: null,
      activeLast24h,
    }
  }

  const avgGl = mean(values)
  const avgMgdl = glToMgdl(avgGl)
  const cv = coefficientOfVariation(values)
  const tir = computeTir(values, thresholds)
  const gmi = glucoseManagementIndicator(avgMgdl)

  return {
    patientId,
    pathology,
    readingCount: entries.length,
    captureRate: Math.round(captureRate * 10) / 10,
    averageGlucoseMgdl: Math.round(avgMgdl),
    gmi: Math.round(gmi * 10) / 10,
    coefficientOfVariation: Math.round(cv * 10) / 10,
    tir,
    activeLast24h,
  }
}

/** Compute per-patient metrics for the given accessible patient IDs. Pure logic, no audit. */
async function computeMetricsBatch(
  patientIds: number[],
  windowDays: number,
): Promise<PopulationPatientMetric[]> {
  if (patientIds.length === 0) return []

  const to = new Date()
  const from = new Date(to.getTime() - windowDays * 24 * 3600_000)
  const twentyFourHoursAgo = new Date(to.getTime() - 24 * 3600_000)

  const patients = await prisma.patient.findMany({
    where: { id: { in: patientIds }, deletedAt: null },
    select: { id: true, pathology: true },
  })
  const thresholdMap = await loadThresholds(patients.map((p) => p.id))

  return Promise.all(
    patients.map((p) =>
      computePatientMetric(
        p.id,
        p.pathology,
        from,
        to,
        windowDays,
        thresholdMap.get(p.id) ?? DEFAULT_THRESHOLDS,
        twentyFourHoursAgo,
      ),
    ),
  )
}

function isSufficient(metric: PopulationPatientMetric): boolean {
  return metric.captureRate >= MIN_CAPTURE_RATE && metric.tir !== null
}

function averageOrNull(values: number[]): number | null {
  if (values.length === 0) return null
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
}

export const populationAnalyticsService = {
  /**
   * Cabinet KPIs (US-2094) — total/active/inTarget/criticalHypo counts and average TIR/GMI.
   * Returns null averages when no patient has sufficient CGM capture.
   *
   * Audit: one `READ` entry on `ANALYTICS` with metadata.kind=population and patientCount.
   * No `metadata.patientId` because this view is cabinet-scoped (multi-patient).
   */
  async cabinetKpis(
    accessiblePatientIds: number[],
    windowDays: number,
    auditUserId: number,
    ctx?: AuditContext,
  ): Promise<PopulationKpi> {
    const window = clampWindow(windowDays)
    const metrics = await computeMetricsBatch(accessiblePatientIds, window)

    const sufficient = metrics.filter(isSufficient)
    const tirValues = sufficient.map((m) => m.tir!.inRange)
    const gmiValues = sufficient.map((m) => m.gmi!).filter((g) => g !== null) as number[]

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "ANALYTICS",
      resourceId: "population",
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      metadata: { kind: "population", patientCount: metrics.length, windowDays: window },
    })

    return {
      windowDays: window,
      totalPatients: metrics.length,
      activeLast24h: metrics.filter((m) => m.activeLast24h).length,
      inTarget: sufficient.filter((m) => m.tir!.inRange >= 70).length,
      criticalHypoCount: metrics.filter((m) => (m.tir?.severeHypo ?? 0) > 0).length,
      averageTimeInRange: averageOrNull(tirValues),
      averageGmi: averageOrNull(gmiValues),
    }
  },

  /**
   * Quality indicators (US-2095) — TIR and GMI distributions over the cabinet.
   * Buckets follow ADA reporting bands.
   */
  async qualityIndicators(
    accessiblePatientIds: number[],
    windowDays: number,
    auditUserId: number,
    ctx?: AuditContext,
  ): Promise<QualityIndicators> {
    const window = clampWindow(windowDays)
    const metrics = await computeMetricsBatch(accessiblePatientIds, window)
    const sufficient = metrics.filter(isSufficient)

    const tirDistribution = { under50: 0, from50to70: 0, from70to90: 0, over90: 0 }
    const gmiDistribution = { under65: 0, from65to75: 0, from75to85: 0, over85: 0 }

    for (const m of sufficient) {
      const tirPct = m.tir!.inRange
      if (tirPct < 50) tirDistribution.under50++
      else if (tirPct < 70) tirDistribution.from50to70++
      else if (tirPct < 90) tirDistribution.from70to90++
      else tirDistribution.over90++

      const gmi = m.gmi
      if (gmi === null) continue
      if (gmi < 6.5) gmiDistribution.under65++
      else if (gmi < 7.5) gmiDistribution.from65to75++
      else if (gmi < 8.5) gmiDistribution.from75to85++
      else gmiDistribution.over85++
    }

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "ANALYTICS",
      resourceId: "quality",
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      metadata: { kind: "quality", patientCount: metrics.length, windowDays: window },
    })

    return {
      windowDays: window,
      tirDistribution,
      gmiDistribution,
      patientsWithSufficientCapture: sufficient.length,
      patientsExcluded: metrics.length - sufficient.length,
    }
  },

  /**
   * Cohort breakdown by pathology (US-2096) — DT1/DT2/GD aggregates.
   */
  async cohortsByPathology(
    accessiblePatientIds: number[],
    windowDays: number,
    auditUserId: number,
    ctx?: AuditContext,
  ): Promise<CohortBreakdown> {
    const window = clampWindow(windowDays)
    const metrics = await computeMetricsBatch(accessiblePatientIds, window)

    const cohorts: CohortBreakdown["cohorts"] = []
    for (const path of [Pathology.DT1, Pathology.DT2, Pathology.GD]) {
      const subset = metrics.filter((m) => m.pathology === path)
      const sufficient = subset.filter(isSufficient)
      cohorts.push({
        pathology: path,
        patientCount: subset.length,
        averageTimeInRange: averageOrNull(sufficient.map((m) => m.tir!.inRange)),
        averageGmi: averageOrNull(
          sufficient.map((m) => m.gmi).filter((g): g is number => g !== null),
        ),
        activeLast24h: subset.filter((m) => m.activeLast24h).length,
      })
    }

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "ANALYTICS",
      resourceId: "cohorts",
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      metadata: { kind: "cohorts", patientCount: metrics.length, windowDays: window },
    })

    return { windowDays: window, cohorts }
  },

  /**
   * Raw population metric list for CSV/Excel export (US-2098).
   * Does not include PII (names/emails); only patient IDs + aggregate metrics.
   * The caller is responsible for CSV formatting and the EXPORT audit action.
   */
  async exportDataset(
    accessiblePatientIds: number[],
    windowDays: number,
  ): Promise<PopulationPatientMetric[]> {
    const window = clampWindow(windowDays)
    return computeMetricsBatch(accessiblePatientIds, window)
  },
}
