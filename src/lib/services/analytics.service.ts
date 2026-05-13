/**
 * @module analytics.service
 * @description Glycemic analytics — Time In Range (TIR), GMI, CV, AGP, hypoglycemia detection.
 * Calculates metrics from CGM data per ADA/EASD consensus standards.
 * Supports up to 90-day periods. Warns if CGM capture rate < 70%.
 * @see CLAUDE.md#analytics — Metrics and thresholds
 * @see src/lib/statistics — Pure calculation functions (TIR, GMI, AGP, hypo detection)
 * @see https://diabetes.org/about-us/statistics/statistics-about-diabetes — ADA consensus
 */

import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import {
  mean, glToMgdl, glucoseManagementIndicator, coefficientOfVariation,
  computeTir, assessTirQuality, computeAgp, detectHypoEpisodes,
  cgmCaptureRate,
  type CgmThresholds,
} from "@/lib/statistics"
import type { AuditContext } from "./patient.service"

/** Warn if CGM capture rate below this % */
const MIN_CAPTURE_RATE = 70 // percent
/** Max query period for analytics (performance limit) */
const MAX_PERIOD_DAYS = 90

/**
 * Parse period string (e.g., "14d" → 14 days).
 * @private
 * @param {string} period - Period format "Nd" (e.g., "14d", "30d")
 * @returns {number} Days as integer
 * @throws {Error} If format invalid or days out of range [1, 90]
 */
function parsePeriod(period: string): number {
  const match = period.match(/^(\d+)d$/)
  if (!match) throw new Error("Invalid period format, use Nd (e.g. 14d)")
  const days = parseInt(match[1], 10)
  if (days < 1 || days > MAX_PERIOD_DAYS) {
    throw new Error(`Period must be between 1 and ${MAX_PERIOD_DAYS} days`)
  }
  return days
}

/**
 * Fetch CGM values for N days (from now going back).
 * @private
 * @param {number} patientId - Patient ID
 * @param {number} days - Number of days to retrieve
 * @returns {Promise<{values: number[], withTimestamp: Array, from: Date, to: Date, entryCount: number, days: number}>} CGM data
 */
async function getPatientCgmValues(patientId: number, days: number) {
  const to = new Date()
  const from = new Date(to.getTime() - days * 24 * 3600_000)

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
  const withTimestamp = entries.map((e) => ({
    valueGl: Number(e.valueGl),
    timestamp: e.timestamp,
  }))

  return { values, withTimestamp, from, to, entryCount: entries.length, days }
}

/**
 * Get CGM thresholds for a patient (from objectives or defaults).
 * @private
 * @param {number} patientId - Patient ID
 * @returns {Promise<CgmThresholds>} Thresholds (veryLow, low, ok, high) in g/L
 */
async function getPatientThresholds(patientId: number): Promise<CgmThresholds> {
  const cgm = await prisma.cgmObjective.findUnique({ where: { patientId } })
  return {
    veryLow: cgm ? Number(cgm.veryLow) : 0.54,
    low: cgm ? Number(cgm.low) : 0.70,
    ok: cgm ? Number(cgm.ok) : 1.80,
    high: cgm ? Number(cgm.high) : 2.50,
  }
}

/**
 * Analytics service — glycemic metrics and trends.
 * @namespace analyticsService
 */
export const analyticsService = {
  /**
   * Compute full glycemic profile — TIR, GMI, CV, AGP.
   * Warnings if CGM capture rate < 70%.
   * @async
   * @param {number} patientId - Patient ID
   * @param {string} period - Period (e.g., "14d", "30d") — max 90d
   * @param {number} auditUserId - User performing read (audit trail)
   * @param {AuditContext} [ctx] - Request context (IP, User-Agent)
   * @returns {Promise<Object>} Profile with metrics, TIR, captureRate, warnings
   * @throws {Error} If period format invalid or exceeds 90 days
   */
  async glycemicProfile(
    patientId: number,
    period: string,
    auditUserId: number,
    ctx?: AuditContext,
  ) {
    const days = parsePeriod(period)
    const { values, from, to, entryCount } = await getPatientCgmValues(patientId, days)
    const thresholds = await getPatientThresholds(patientId)

    const captureRate = cgmCaptureRate(entryCount, days)
    const avgGl = mean(values)
    const avgMgdl = glToMgdl(avgGl)
    const cv = coefficientOfVariation(values)
    const tir = computeTir(values, thresholds)
    const quality = assessTirQuality(tir, cv)
    const gmi = glucoseManagementIndicator(avgMgdl)

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      // US-2268 — vue analytique agrégée par patient → resourceId = patientId,
      // metadata.kind discrimine la sous-vue.
      resource: "ANALYTICS",
      resourceId: String(patientId),
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      metadata: { patientId, kind: "profile" },
    })

    return {
      period: { from: from.toISOString(), to: to.toISOString(), days },
      captureRate: Math.round(captureRate * 10) / 10,
      warning: captureRate < MIN_CAPTURE_RATE ? "insufficientCgmCapture" : undefined,
      metrics: {
        averageGlucoseGl: Math.round(avgGl * 100) / 100,
        averageGlucoseMgdl: Math.round(avgMgdl),
        gmi: Math.round(gmi * 10) / 10,
        coefficientOfVariation: Math.round(cv * 10) / 10,
        quality,
      },
      tir,
      readingCount: entryCount,
    }
  },

  /**
   * Compute Time In Range (TIR) — percentage in target, high, low, severe low zones.
   * @async
   * @param {number} patientId - Patient ID
   * @param {string} period - Period (e.g., "14d", "30d")
   * @param {number} auditUserId - User performing read (audit trail)
   * @param {AuditContext} [ctx] - Request context (IP, User-Agent)
   * @returns {Promise<{tir: TirResult, quality: TirQuality, thresholds, readingCount, captureRate}>} TIR result with quality assessment
   */
  async timeInRange(
    patientId: number,
    period: string,
    auditUserId: number,
    ctx?: AuditContext,
  ) {
    const days = parsePeriod(period)
    const { values, entryCount } = await getPatientCgmValues(patientId, days)
    const thresholds = await getPatientThresholds(patientId)

    const tir = computeTir(values, thresholds)
    const cv = coefficientOfVariation(values)
    const quality = assessTirQuality(tir, cv)

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      // US-2268 — vue analytique agrégée par patient.
      resource: "ANALYTICS",
      resourceId: String(patientId),
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      metadata: { patientId, kind: "tir" },
    })

    return {
      tir,
      quality,
      thresholds,
      readingCount: entryCount,
      captureRate: Math.round(cgmCaptureRate(entryCount, days) * 10) / 10,
    }
  },

  /**
   * Compute Ambulatory Glucose Profile (AGP) — percentiles per 15-min time slot.
   * 96 slots over 24 hours (p10, p25, p50, p75, p90).
   * @async
   * @param {number} patientId - Patient ID
   * @param {string} period - Period (e.g., "14d", "30d")
   * @param {number} auditUserId - User performing read (audit trail)
   * @param {AuditContext} [ctx] - Request context (IP, User-Agent)
   * @returns {Promise<Array<AgpSlot>>} 96 slots with percentiles and timeMinutes
   */
  async agp(
    patientId: number,
    period: string,
    auditUserId: number,
    ctx?: AuditContext,
  ) {
    const days = parsePeriod(period)
    const { withTimestamp } = await getPatientCgmValues(patientId, days)

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      // US-2268 — vue analytique agrégée par patient.
      resource: "ANALYTICS",
      resourceId: String(patientId),
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      metadata: { patientId, kind: "agp" },
    })

    return computeAgp(withTimestamp)
  },

  /**
   * Detect hypoglycemia episodes — 3+ consecutive readings below threshold, max 30-min gap.
   * Classifies as level1 (low) or level2 (severe low) based on nadir.
   * @async
   * @param {number} patientId - Patient ID
   * @param {string} period - Period (e.g., "14d", "30d")
   * @param {number} auditUserId - User performing read (audit trail)
   * @param {AuditContext} [ctx] - Request context (IP, User-Agent)
   * @returns {Promise<{episodeCount, episodes: HypoEpisode[], level1Count, level2Count}>} Episodes with severity
   */
  async hypoglycemia(
    patientId: number,
    period: string,
    auditUserId: number,
    ctx?: AuditContext,
  ) {
    const days = parsePeriod(period)
    const { withTimestamp } = await getPatientCgmValues(patientId, days)
    const thresholds = await getPatientThresholds(patientId)

    const episodes = detectHypoEpisodes(withTimestamp, {
      low: thresholds.low,
      veryLow: thresholds.veryLow,
    })

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      // US-2268 — vue analytique agrégée par patient.
      resource: "ANALYTICS",
      resourceId: String(patientId),
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      metadata: { patientId, kind: "hypo" },
    })

    return {
      episodeCount: episodes.length,
      episodes,
      level1Count: episodes.filter((e) => e.severity === "level1").length,
      level2Count: episodes.filter((e) => e.severity === "level2").length,
    }
  },

  /**
   * Summarize insulin administration over a period.
   * Computes total units, daily average, pump events.
   * @async
   * @param {number} patientId - Patient ID
   * @param {Date} from - Start date
   * @param {Date} to - End date
   * @param {number} auditUserId - User performing read (audit trail)
   * @param {AuditContext} [ctx] - Request context (IP, User-Agent)
   * @returns {Promise<{totalUnits, avgDailyUnits, dayCount, flow, pumpEvents}>} Insulin summary
   */
  async insulinSummary(
    patientId: number,
    from: Date,
    to: Date,
    auditUserId: number,
    ctx?: AuditContext,
  ) {
    const [flow, pumpEvents] = await Promise.all([
      prisma.insulinFlowEntry.findMany({
        where: { patientId, date: { gte: from, lte: to } },
        orderBy: { date: "asc" },
      }),
      prisma.pumpEvent.findMany({
        where: { patientId, timestamp: { gte: from, lte: to } },
        orderBy: { timestamp: "asc" },
      }),
    ])

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      // US-2268 — vue analytique agrégée par patient.
      resource: "ANALYTICS",
      resourceId: String(patientId),
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      metadata: { patientId, kind: "insulin" },
    })

    const totalUnits = flow.reduce((sum, f) => sum + (f.flow?.toNumber() ?? 0), 0)
    const distinctDays = new Set(flow.map((f) => f.date.toISOString().split("T")[0])).size
    const avgDaily = distinctDays > 0 ? totalUnits / distinctDays : 0

    // Convert Decimal fields to numbers for JSON serialization
    const flowData = flow.map((f) => ({
      id: f.id,
      patientId: f.patientId,
      date: f.date,
      flow: f.flow?.toNumber() ?? null,
    }))

    return {
      totalUnits: Math.round(totalUnits * 100) / 100,
      avgDailyUnits: Math.round(avgDaily * 100) / 100,
      dayCount: distinctDays,
      flow: flowData,
      pumpEvents,
    }
  },

  /**
   * Heat-map glycémique (US-2038) — 7 days × 24 hours grid (168 cells).
   * Each cell aggregates the patient's CGM readings whose timestamp matches
   * (dayOfWeek, hour). Returns avg glucose in mg/dL + reading count per cell.
   *
   * Days are indexed Mon=0..Sun=6 to match clinical conventions (week starts
   * Monday in FR/EU). Cells with zero readings carry `avgMgdl=null`.
   *
   * Window bounded to MAX_PERIOD_DAYS for performance. Long periods are
   * tolerated but capped.
   */
  async heatmap(
    patientId: number,
    period: string,
    auditUserId: number,
    ctx?: AuditContext,
  ) {
    const days = parsePeriod(period)
    const { withTimestamp, from, to, entryCount } = await getPatientCgmValues(patientId, days)

    type Cell = { sumGl: number; count: number }
    const cells: Cell[] = Array.from({ length: 7 * 24 }, () => ({ sumGl: 0, count: 0 }))

    for (const r of withTimestamp) {
      // Sunday=0..Saturday=6 → Monday=0..Sunday=6 (FR week)
      const jsDow = r.timestamp.getDay()
      const dayOfWeek = (jsDow + 6) % 7
      const hour = r.timestamp.getHours()
      const idx = dayOfWeek * 24 + hour
      cells[idx].sumGl += r.valueGl
      cells[idx].count++
    }

    const grid = cells.map((c, idx) => ({
      dayOfWeek: Math.floor(idx / 24),
      hour: idx % 24,
      readingCount: c.count,
      avgMgdl: c.count > 0 ? Math.round(glToMgdl(c.sumGl / c.count)) : null,
    }))

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      // US-2268 — patient-scoped analytics view.
      resource: "ANALYTICS",
      resourceId: String(patientId),
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      metadata: { patientId, kind: "heatmap" },
    })

    return {
      period: { from: from.toISOString(), to: to.toISOString(), days },
      readingCount: entryCount,
      cells: grid,
    }
  },

  /**
   * Comparaison de deux périodes (US-2039) — calcule les métriques (TIR, GMI,
   * CV, captureRate) sur deux fenêtres successives et expose le delta. Utilisé
   * pour évaluer l'effet d'un ajustement thérapeutique.
   *
   * Le caller passe la durée commune des deux fenêtres (en jours). La fenêtre
   * A se termine `gapDays` après le début de la fenêtre B — par défaut elles
   * sont contiguës (gap = 0) et la fenêtre B est la plus récente.
   */
  async compare(
    patientId: number,
    period: string,
    auditUserId: number,
    ctx?: AuditContext,
  ) {
    const days = parsePeriod(period)
    const now = new Date()
    const recentTo = now
    const recentFrom = new Date(now.getTime() - days * 24 * 3600_000)
    const previousTo = new Date(recentFrom.getTime() - 1)
    const previousFrom = new Date(previousTo.getTime() - days * 24 * 3600_000)

    const thresholds = await getPatientThresholds(patientId)

    const [recentEntries, previousEntries] = await Promise.all([
      prisma.cgmEntry.findMany({
        where: {
          patientId,
          timestamp: { gte: recentFrom, lte: recentTo },
          valueGl: { gte: 0.40, lte: 5.00 },
        },
        select: { valueGl: true },
      }),
      prisma.cgmEntry.findMany({
        where: {
          patientId,
          timestamp: { gte: previousFrom, lte: previousTo },
          valueGl: { gte: 0.40, lte: 5.00 },
        },
        select: { valueGl: true },
      }),
    ])

    const summarize = (rows: Array<{ valueGl: unknown }>, periodFrom: Date, periodTo: Date) => {
      const values = rows.map((e) => Number(e.valueGl))
      const avgGl = mean(values)
      const avgMgdl = glToMgdl(avgGl)
      return {
        from: periodFrom.toISOString(),
        to: periodTo.toISOString(),
        readingCount: values.length,
        captureRate: Math.round(cgmCaptureRate(values.length, days) * 10) / 10,
        averageGlucoseMgdl: values.length > 0 ? Math.round(avgMgdl) : null,
        gmi: values.length > 0 ? Math.round(glucoseManagementIndicator(avgMgdl) * 10) / 10 : null,
        coefficientOfVariation:
          values.length > 0 ? Math.round(coefficientOfVariation(values) * 10) / 10 : null,
        tir: values.length > 0 ? computeTir(values, thresholds) : null,
      }
    }

    const recent = summarize(recentEntries, recentFrom, recentTo)
    const previous = summarize(previousEntries, previousFrom, previousTo)

    const delta = {
      inRangePct:
        recent.tir && previous.tir
          ? Math.round((recent.tir.inRange - previous.tir.inRange) * 10) / 10
          : null,
      gmi:
        recent.gmi !== null && previous.gmi !== null
          ? Math.round((recent.gmi - previous.gmi) * 10) / 10
          : null,
      averageGlucoseMgdl:
        recent.averageGlucoseMgdl !== null && previous.averageGlucoseMgdl !== null
          ? recent.averageGlucoseMgdl - previous.averageGlucoseMgdl
          : null,
    }

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "ANALYTICS",
      resourceId: String(patientId),
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      metadata: { patientId, kind: "compare", days },
    })

    return { previous, recent, delta }
  },
}
