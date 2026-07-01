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
  mean, glToMgdl, glucoseManagementIndicator, coefficientOfVariation, stddev,
  computeTir, assessTirQuality, computeAgp, detectHypoEpisodes,
  cgmCaptureRate,
  ANALYTICS_WARNINGS,
  type AnalyticsWarning,
  type CgmThresholds,
} from "@/lib/statistics"
import { decimalToNumber } from "@/lib/db/decimal"
import { CGM_AGGREGATE_RANGE_GL } from "@/lib/clinical-bounds"

/** Warn if CGM capture rate below this % */
const MIN_CAPTURE_RATE = 70 // percent
/** Max query period for single-window analytics (performance limit). */
const MAX_PERIOD_DAYS = 90
/** Max period per window for `compare` (two windows = 90d total, perf-safe). */
const MAX_COMPARE_PERIOD_DAYS = 45

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
 * for AGGREGATES (`CGM_AGGREGATE_RANGE_GL` = 0.20–6.00 g/L, la plage
 * physiologique valide en base) et la coercion Decimal→number (`.toNumber()`
 * pour éviter la perte de précision silencieuse).
 *
 * NB : on inclut volontairement les hypo sévères mesurées sous le plancher
 * d'affichage (0.20–0.40 g/L) — sinon `severeHypo`/moyenne/CV sous-estiment la
 * charge hypoglycémique (cf. `CGM_AGGREGATE_RANGE_GL` dans clinical-bounds).
 * @private
 */
async function getPatientCgmRange(patientId: number, from: Date, to: Date) {
  const entries = await prisma.cgmEntry.findMany({
    where: {
      patientId,
      timestamp: { gte: from, lte: to },
      valueGl: { gte: CGM_AGGREGATE_RANGE_GL.MIN, lte: CGM_AGGREGATE_RANGE_GL.MAX },
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

/** Ligne brute renvoyée par la requête d'agrégation journalière (US-2636). */
interface RawDailyRow {
  day: string
  avg_gl: number
  min_gl: number
  max_gl: number
  n: number
  in_target: number
}

/** Statistique journalière projetée (mg/dL) — 1 ligne par jour (US-2636). */
export interface DailyStat {
  /** Jour calendaire Europe/Paris, ISO `YYYY-MM-DD`. */
  day: string
  avgMgdl: number
  minMgdl: number
  maxMgdl: number
  count: number
  /** % de relevés du jour en cible pathology-aware (`[low, ok]`). */
  inTargetPct: number
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
    // Écart type (SD) en mg/dL — socle US-2631 (bandeau stats AGP).
    const sdMgdl = glToMgdl(stddev(values))
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
        // US-2634 — fenêtre lue tracée (poids forensique : 90 j ≠ 7 j) ; jamais
        // de valeur clinique dans metadata.
        metadata: { patientId, kind: "profile", period, windowDays: days },
      })
    }

    return {
      period: { from: from.toISOString(), to: to.toISOString(), days },
      captureRate: Math.round(captureRate * 10) / 10,
      warning: (captureRate < MIN_CAPTURE_RATE
        ? ANALYTICS_WARNINGS.INSUFFICIENT_CGM_CAPTURE
        : undefined) as AnalyticsWarning | undefined,
      // Cible **pathology-aware** exposée au rendu (socle US-2631) : la vue
      // dessine la bande / colore avec CES bornes (GD 63–140 vs adulte 70–180),
      // jamais des constantes 70–180 en dur. `low`/`ok` = bornes basse/haute de
      // la cible (thresholds en g/L → mg/dL).
      targetRangeMgdl: {
        low: Math.round(glToMgdl(thresholds.low)),
        high: Math.round(glToMgdl(thresholds.ok)),
      },
      metrics: {
        averageGlucoseGl: Math.round(avgGl * 100) / 100,
        averageGlucoseMgdl: Math.round(avgMgdl),
        gmi: Math.round(gmi * 10) / 10,
        coefficientOfVariation: Math.round(cv * 10) / 10,
        stdDevMgdl: Math.round(sdMgdl),
        quality,
      },
      tir,
      readingCount: entryCount,
    }
  },

  /**
   * US-2631 (socle BGM) — statistiques de glycémie **capillaire (BGM)** pour un
   * patient sans capteur. Lit `GlycemiaEntry` (jamais `CgmEntry`).
   *
   * ⚠️ `inRangePercent` est un **% de relevés en cible**, PAS un TIR (temps) :
   * les relevés capillaires ne sont pas répartis uniformément dans le temps
   * (mesurés autour des repas/symptômes) → biais d'échantillonnage, non
   * comparable au TIR CGM ni inter-patient. L'UI doit le libeller distinctement.
   * Cible **pathology-aware** via `getPatientThresholds` (GD 63–140 vs 70–180).
   *
   * `opts.skipAudit` : à n'utiliser QUE si l'appelant (route/composite) écrit
   * lui-même une ligne d'audit patient-scoped couvrant cette lecture — sinon
   * c'est une lecture de PHI non tracée (interdit HDS).
   */
  async bgmStats(
    patientId: number,
    period: string,
    auditUserId: number,
    ctx?: AuditContext,
    opts?: { skipAudit?: boolean },
  ) {
    const days = parsePeriod(period)
    const now = new Date()
    const since = new Date(now.getTime() - days * 24 * 3600_000)
    const thresholds = await getPatientThresholds(patientId)

    const rows = await prisma.glycemiaEntry.findMany({
      where: {
        patientId,
        // Borne haute = maintenant : écarte les saisies datées dans le futur
        // (erreur de saisie) qui fausseraient total/%/fréquence.
        date: { gte: since, lte: now },
        OR: [{ glycemiaGl: { not: null } }, { glycemiaMgdl: { not: null } }],
      },
      select: { glycemiaGl: true, glycemiaMgdl: true },
    })

    // Valeur en g/L (préfère `glycemiaGl`, sinon mg/dL → g/L), filtrée sur la
    // plage physiologique valide comme les autres agrégats. NB : ce filtre
    // écarte aussi les extrêmes « LO/HI » du lecteur (< 0,20 / > 6,00 g/L) —
    // cohérent avec les agrégats CGM et le rejet des valeurs d'erreur capteur ;
    // impact négligeable (rareté), tracé ici pour transparence (revue médicale).
    const valuesGl = rows
      .map((r) => {
        if (r.glycemiaGl != null) return decimalToNumber(r.glycemiaGl)
        if (r.glycemiaMgdl != null) return decimalToNumber(r.glycemiaMgdl) / 100
        return NaN
      })
      .filter(
        (v) => Number.isFinite(v) && v >= CGM_AGGREGATE_RANGE_GL.MIN && v <= CGM_AGGREGATE_RANGE_GL.MAX,
      )

    const total = valuesGl.length
    const inRange = valuesGl.filter((v) => v >= thresholds.low && v <= thresholds.ok).length

    if (!opts?.skipAudit) {
      await auditService.log({
        userId: auditUserId,
        action: "READ",
        resource: "GLYCEMIA_ENTRY",
        resourceId: String(patientId),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        requestId: ctx?.requestId,
        metadata: { patientId, kind: "bgmStats", period: `${days}d` },
      })
    }

    return {
      period: { days },
      total,
      // % de relevés en cible (≠ TIR). `null` si aucun relevé exploitable.
      inRangePercent: total > 0 ? Math.round((inRange / total) * 1000) / 10 : null,
      readingsPerDay: Math.round((total / days) * 10) / 10,
      targetRangeMgdl: {
        low: Math.round(glToMgdl(thresholds.low)),
        high: Math.round(glToMgdl(thresholds.ok)),
      },
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
   * US-2636 — Statistiques **journalières** (1 ligne par jour calendaire
   * Europe/Paris) : moyenne, min, max, nombre de relevés, % en cible.
   *
   * Perf (AC-3) : agrégation **en base** (`GROUP BY` sur la journée locale),
   * bornée par l'index `[patientId, timestamp]` (CGM) / `[patientId, date]`
   * (BGM) et plafonnée à 90 lignes — jamais de chargement de 90 j en mémoire.
   * % en cible **pathology-aware** (AC-1) : bornes `[low, ok]` du patient (g/L),
   * GD 63–140 vs 70–180. Projection serveur pure (AC-2) : le front n'affiche
   * que ces lignes déjà triées desc.
   */
  async dailyStats(
    patientId: number,
    period: string,
    auditUserId: number,
    ctx?: AuditContext,
    opts?: { source?: "cgm" | "bgm"; skipAudit?: boolean },
  ): Promise<DailyStat[]> {
    const days = parsePeriod(period)
    const to = new Date()
    const from = new Date(to.getTime() - days * 24 * 3600_000)
    const thresholds = await getPatientThresholds(patientId) // g/L, pathology-aware
    const source = opts?.source ?? "cgm"

    if (!opts?.skipAudit) {
      await auditService.log({
        userId: auditUserId,
        action: "READ",
        resource: "ANALYTICS",
        resourceId: String(patientId),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        requestId: ctx?.requestId,
        metadata: { patientId, kind: "dailyStats", period, windowDays: days, source },
      })
    }

    const rows =
      source === "bgm"
        ? await prisma.$queryRaw<RawDailyRow[]>`
            SELECT to_char(date, 'YYYY-MM-DD') AS day,
                   AVG(glycemia_gl)::float8 AS avg_gl,
                   MIN(glycemia_gl)::float8 AS min_gl,
                   MAX(glycemia_gl)::float8 AS max_gl,
                   COUNT(*)::int AS n,
                   COUNT(*) FILTER (
                     WHERE glycemia_gl >= ${thresholds.low} AND glycemia_gl <= ${thresholds.ok}
                   )::int AS in_target
            FROM glycemia_entries
            WHERE patient_id = ${patientId}
              AND date >= ${from} AND date <= ${to}
              AND glycemia_gl IS NOT NULL
            GROUP BY day
            ORDER BY day DESC
            LIMIT 90`
        : await prisma.$queryRaw<RawDailyRow[]>`
            SELECT to_char((timestamp AT TIME ZONE 'Europe/Paris')::date, 'YYYY-MM-DD') AS day,
                   AVG(value_gl)::float8 AS avg_gl,
                   MIN(value_gl)::float8 AS min_gl,
                   MAX(value_gl)::float8 AS max_gl,
                   COUNT(*)::int AS n,
                   COUNT(*) FILTER (
                     WHERE value_gl >= ${thresholds.low} AND value_gl <= ${thresholds.ok}
                   )::int AS in_target
            FROM cgm_entries
            WHERE patient_id = ${patientId}
              AND timestamp >= ${from} AND timestamp <= ${to}
              AND value_gl >= ${CGM_AGGREGATE_RANGE_GL.MIN} AND value_gl <= ${CGM_AGGREGATE_RANGE_GL.MAX}
            GROUP BY day
            ORDER BY day DESC
            LIMIT 90`

    return rows.map((r) => ({
      day: r.day,
      avgMgdl: Math.round(glToMgdl(r.avg_gl)),
      minMgdl: Math.round(glToMgdl(r.min_gl)),
      maxMgdl: Math.round(glToMgdl(r.max_gl)),
      count: r.n,
      inTargetPct: r.n > 0 ? Math.round((r.in_target / r.n) * 100) : 0,
    }))
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
