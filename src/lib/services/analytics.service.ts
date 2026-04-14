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
      resource: "CGM_ENTRY",
      resourceId: `${patientId}:analytics:profile`,
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
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
      resource: "CGM_ENTRY",
      resourceId: `${patientId}:analytics:tir`,
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
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
      resource: "CGM_ENTRY",
      resourceId: `${patientId}:analytics:agp`,
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
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
      resource: "CGM_ENTRY",
      resourceId: `${patientId}:analytics:hypo`,
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
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
      resource: "INSULIN_THERAPY",
      resourceId: `${patientId}:analytics:insulin`,
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
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
}
