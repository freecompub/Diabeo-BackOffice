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
import type { AuditContext } from "./audit.service"
import { getCgmDefaults } from "./objectives.service"
import {
  mean, glToMgdl, glucoseManagementIndicator, coefficientOfVariation,
  computeTir, assessTirQuality, computeAgp, detectHypoEpisodes,
  cgmCaptureRate,
  ANALYTICS_WARNINGS,
  type AnalyticsWarning,
  type CgmThresholds,
} from "@/lib/statistics"
import { decimalToNumber } from "@/lib/db/decimal"

/** Warn if CGM capture rate below this % */
const MIN_CAPTURE_RATE = 70 // percent
/** Max query period for single-window analytics (performance limit). */
const MAX_PERIOD_DAYS = 90
/** Max period per window for `compare` (two windows = 90d total, perf-safe). */
const MAX_COMPARE_PERIOD_DAYS = 45

/**
 * Plage de valeurs CGM **physiologiquement valides** pour les AGRÉGATS
 * (moyenne, CV, GMI, TIR, AGP, épisodes hypo) — alignée sur le CHECK base
 * (`value_gl BETWEEN 0.20 AND 6.00`, `cgm_partitioning.sql`).
 *
 * ⚠️ DIFFÉRENT du plancher d'AFFICHAGE de la série (0.40–5.00 g/L,
 * `glycemia.service.getCgmEntries`). Les agrégats doivent inclure les hypo
 * sévères réelles mesurées sous le plancher d'affichage (0.20–0.40 g/L) et les
 * hyper extrêmes (5.00–6.00) : sinon le bucket `severeHypo` du TIR et la
 * moyenne/CV **sous-estiment la charge hypoglycémique** (consensus ADA/Battelino —
 * tout relevé CGM valide compte dans le TIR ; les valeurs « LOW » capteur sont
 * comptées dans la zone la plus basse). La série graphique, elle, reste filtrée
 * au plancher d'affichage + caveat de fraîcheur (PR #555).
 */
const CGM_AGG_MIN_GL = 0.20
const CGM_AGG_MAX_GL = 6.00

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
 * Fetch CGM values for an explicit window. Centralizes the valid-range filter
 * for AGGREGATES ({@link CGM_AGG_MIN_GL}–{@link CGM_AGG_MAX_GL} = 0.20–6.00 g/L,
 * la plage physiologique valide en base) et la coercion Decimal→number
 * (`.toNumber()` pour éviter la perte de précision silencieuse).
 *
 * NB : on inclut volontairement les hypo sévères mesurées sous le plancher
 * d'affichage (0.20–0.40 g/L) — sinon `severeHypo`/moyenne/CV sous-estiment la
 * charge hypoglycémique (cf. {@link CGM_AGG_MIN_GL}).
 * @private
 */
async function getPatientCgmRange(patientId: number, from: Date, to: Date) {
  const entries = await prisma.cgmEntry.findMany({
    where: {
      patientId,
      timestamp: { gte: from, lte: to },
      valueGl: { gte: CGM_AGG_MIN_GL, lte: CGM_AGG_MAX_GL },
    },
    orderBy: { timestamp: "asc" },
    select: { valueGl: true, timestamp: true },
  })

  const withTimestamp = entries.map((e) => ({
    valueGl: decimalToNumber(e.valueGl),
    timestamp: e.timestamp,
  }))
  const values = withTimestamp.map((e) => e.valueGl)

  return { values, withTimestamp, from, to, entryCount: entries.length }
}

/**
 * Fetch CGM values for N days (from now going back).
 * @private
 */
async function getPatientCgmValues(patientId: number, days: number) {
  const to = new Date()
  const from = new Date(to.getTime() - days * 24 * 3600_000)
  const range = await getPatientCgmRange(patientId, from, to)
  return { ...range, days }
}

/**
 * Get CGM thresholds for a patient (from objectives or defaults).
 * @private
 * @param {number} patientId - Patient ID
 * @returns {Promise<CgmThresholds>} Thresholds (veryLow, low, ok, high) in g/L
 */
async function getPatientThresholds(patientId: number): Promise<CgmThresholds> {
  const cgm = await prisma.cgmObjective.findUnique({ where: { patientId } })
  if (!cgm) {
    // Pas d'objectif CGM configuré → défauts **pathology-aware** : la grossesse
    // (GD) impose une cible plus stricte (63–140 mg/dL, Battelino 2019) que les
    // 70–180 génériques. Sans ça, le TIR d'une patiente GD serait évalué sur une
    // plage trop large (faux rassurement). Cf. `getCgmDefaults`.
    const patient = await prisma.patient.findFirst({
      where: { id: patientId, deletedAt: null },
      select: { pathology: true },
    })
    const d = getCgmDefaults(patient?.pathology ?? undefined)
    return { veryLow: d.veryLow, low: d.low, ok: d.ok, high: d.high }
  }
  return {
    veryLow: Number(cgm.veryLow),
    low: Number(cgm.low),
    ok: Number(cgm.ok),
    high: Number(cgm.high),
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
    opts?: { skipAudit?: boolean },
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

    // Audit suppressed when the caller wraps this in a higher-level EXPORT
    // (e.g. AGP PDF download writes a single EXPORT row instead of 3 READs).
    if (!opts?.skipAudit) {
      await auditService.log({
        userId: auditUserId,
        action: "READ",
        // US-2268 — vue analytique agrégée par patient → resourceId = patientId,
        // metadata.kind discrimine la sous-vue.
        resource: "ANALYTICS",
        resourceId: String(patientId),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,

        requestId: ctx?.requestId,
        metadata: { patientId, kind: "profile" },
      })
    }

    return {
      period: { from: from.toISOString(), to: to.toISOString(), days },
      captureRate: Math.round(captureRate * 10) / 10,
      warning: (captureRate < MIN_CAPTURE_RATE
        ? ANALYTICS_WARNINGS.INSUFFICIENT_CGM_CAPTURE
        : undefined) as AnalyticsWarning | undefined,
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

      requestId: ctx?.requestId,
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
    opts?: { skipAudit?: boolean },
  ) {
    const days = parsePeriod(period)
    const { withTimestamp } = await getPatientCgmValues(patientId, days)

    if (!opts?.skipAudit) {
      await auditService.log({
        userId: auditUserId,
        action: "READ",
        // US-2268 — vue analytique agrégée par patient.
        resource: "ANALYTICS",
        resourceId: String(patientId),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,

        requestId: ctx?.requestId,
        metadata: { patientId, kind: "agp" },
      })
    }

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

      requestId: ctx?.requestId,
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

      requestId: ctx?.requestId,
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

    // Pin to Europe/Paris so the (dayOfWeek, hour) grouping matches French
    // clinical conventions regardless of the server's local timezone.
    const tzFmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Paris",
      weekday: "short",
      hour: "2-digit",
      hourCycle: "h23",
    })
    const dowIndex: Record<string, number> = {
      Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
    }
    for (const r of withTimestamp) {
      const parts = tzFmt.formatToParts(r.timestamp)
      const wk = parts.find((p) => p.type === "weekday")?.value ?? "Mon"
      const hrStr = parts.find((p) => p.type === "hour")?.value ?? "0"
      const dayOfWeek = dowIndex[wk] ?? 0
      const hour = parseInt(hrStr, 10) % 24
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

      requestId: ctx?.requestId,
      metadata: {
        patientId,
        kind: "heatmap",
        from: from.toISOString(),
        to: to.toISOString(),
      },
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
    if (days > MAX_COMPARE_PERIOD_DAYS) {
      // Defense-in-depth: the route already enforces ≤ 45d via Zod, but a
      // direct service call must not bypass the per-window cap (two windows
      // would exceed the 90-day perf budget).
      throw new Error(`Period must not exceed ${MAX_COMPARE_PERIOD_DAYS} days for compare`)
    }
    const now = new Date()
    const recentTo = now
    const recentFrom = new Date(now.getTime() - days * 24 * 3600_000)
    // Half-open intervals: previous is [previousFrom, recentFrom) — no overlap,
    // no 1ms gap to skip readings around the boundary.
    const previousFrom = new Date(recentFrom.getTime() - days * 24 * 3600_000)

    const thresholds = await getPatientThresholds(patientId)

    const [recentRange, previousRange] = await Promise.all([
      getPatientCgmRange(patientId, recentFrom, recentTo),
      getPatientCgmRange(patientId, previousFrom, recentFrom),
    ])

    const summarize = (
      rangeValues: number[],
      periodFrom: Date,
      periodTo: Date,
      entryCount: number,
    ) => {
      const avgGl = mean(rangeValues)
      const avgMgdl = glToMgdl(avgGl)
      const captureRate = cgmCaptureRate(entryCount, days)
      return {
        from: periodFrom.toISOString(),
        to: periodTo.toISOString(),
        readingCount: entryCount,
        captureRate: Math.round(captureRate * 10) / 10,
        warning: (captureRate < MIN_CAPTURE_RATE
          ? ANALYTICS_WARNINGS.INSUFFICIENT_CGM_CAPTURE
          : undefined) as AnalyticsWarning | undefined,
        averageGlucoseMgdl: entryCount > 0 ? Math.round(avgMgdl) : null,
        gmi: entryCount > 0 ? Math.round(glucoseManagementIndicator(avgMgdl) * 10) / 10 : null,
        coefficientOfVariation:
          entryCount > 0 ? Math.round(coefficientOfVariation(rangeValues) * 10) / 10 : null,
        tir: entryCount > 0 ? computeTir(rangeValues, thresholds) : null,
      }
    }

    const recent = summarize(recentRange.values, recentFrom, recentTo, recentRange.entryCount)
    const previous = summarize(
      previousRange.values, previousFrom, recentFrom, previousRange.entryCount,
    )

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

      requestId: ctx?.requestId,
      metadata: {
        patientId,
        kind: "compare",
        days,
        recentFrom: recentFrom.toISOString(),
        recentTo: recentTo.toISOString(),
        previousFrom: previousFrom.toISOString(),
      },
    })

    return { previous, recent, delta }
  },
}
