/**
 * @module statistics
 * @description Pure statistical functions for glycemic analytics.
 * All glucose values in g/L unless stated otherwise (1 g/L = 100 mg/dL).
 * Functions are pure (no side effects) and can be tested independently.
 * Used by analyticsService and adjustment algorithms.
 * @see CLAUDE.md#analytics — Metrics calculation
 * @see https://diabetes.org/about-us/statistics/statistics-about-diabetes — ADA metrics
 */

/**
 * Convert glucose from g/L to mg/dL.
 * @param {number} gl - Glucose in g/L
 * @returns {number} Glucose in mg/dL
 * @example
 * glToMgdl(1.50) // Returns 150
 */
export function glToMgdl(gl: number): number {
  return gl * 100
}

/**
 * Glucose Management Indicator (GMI) — ADA/EASD preferred metric over eA1c.
 * Formula: 3.31 + 0.02392 * avgMgdl
 * Represents equivalent HbA1c from average glucose without requiring blood draw.
 * @param {number} avgGlucoseMgdl - Average glucose in mg/dL
 * @returns {number} GMI (% NGSP equivalent)
 * @see https://diabetes.org/about-us/statistics/statistics-about-diabetes — GMI formula
 */
export function glucoseManagementIndicator(avgGlucoseMgdl: number): number {
  return 3.31 + 0.02392 * avgGlucoseMgdl
}

/**
 * Arithmetic mean (average) of numeric array.
 * Returns 0 for empty array.
 * @param {number[]} values - Array of glucose values
 * @returns {number} Mean value
 */
export function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

/**
 * Sample standard deviation (Bessel's correction: n-1 denominator).
 * Returns 0 for arrays with < 2 elements.
 * @param {number[]} values - Array of glucose values
 * @returns {number} Standard deviation
 */
export function stddev(values: number[]): number {
  if (values.length < 2) return 0
  const m = mean(values)
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

/**
 * Coefficient of Variation (CV) — percentage variability in glucose.
 * Formula: (stddev / mean) * 100
 * Lower CV = more stable glucose control. Returns 0 if mean is 0.
 * @param {number[]} values - Array of glucose values (g/L)
 * @returns {number} CV percentage (ideal < 36%)
 */
export function coefficientOfVariation(values: number[]): number {
  const m = mean(values)
  if (m === 0) return 0
  return (stddev(values) / m) * 100
}

/**
 * Calculate percentile with linear interpolation.
 * @param {number[]} sorted - Pre-sorted array (ascending)
 * @param {number} p - Percentile (0-100)
 * @returns {number} Percentile value
 */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  if (sorted.length === 1) return sorted[0]
  const idx = (p / 100) * (sorted.length - 1)
  const lower = Math.floor(idx)
  const upper = Math.ceil(idx)
  if (lower === upper) return sorted[lower]
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower)
}

/**
 * CGM threshold configuration for Time In Range calculation.
 * Values in g/L (0.54 = 54 mg/dL).
 * @typedef {Object} CgmThresholds
 * @property {number} veryLow - Severe hypoglycemia (typically 0.54 g/L = 54 mg/dL)
 * @property {number} low - Hypoglycemia (typically 0.70 g/L = 70 mg/dL)
 * @property {number} ok - Upper normal (typically 1.80 g/L = 180 mg/dL)
 * @property {number} high - Hyperglycemia (typically 2.50 g/L = 250 mg/dL)
 */
export interface CgmThresholds {
  veryLow: number
  low: number
  ok: number
  high: number
}

/**
 * Time In Range result — percentage in each glucose zone.
 * @typedef {Object} TirResult
 * @property {number} severeHypo - % of readings < veryLow threshold
 * @property {number} hypo - % of readings between veryLow and low
 * @property {number} inRange - % of readings between low and ok
 * @property {number} elevated - % of readings between ok and high
 * @property {number} hyper - % of readings > high
 */
export interface TirResult {
  severeHypo: number
  hypo: number
  inRange: number
  elevated: number
  hyper: number
}

/**
 * Compute Time In Range (TIR) from glucose values.
 * @param {number[]} values - Array of glucose values (g/L)
 * @param {CgmThresholds} thresholds - Zone thresholds
 * @returns {TirResult} Percentage in each zone (all percentages sum to 100)
 */
export function computeTir(values: number[], thresholds: CgmThresholds): TirResult {
  if (values.length === 0) {
    return { severeHypo: 0, hypo: 0, inRange: 0, elevated: 0, hyper: 0 }
  }
  const n = values.length
  let severeHypo = 0, hypo = 0, inRange = 0, elevated = 0, hyper = 0

  for (const v of values) {
    if (v < thresholds.veryLow) severeHypo++
    else if (v < thresholds.low) hypo++
    else if (v <= thresholds.ok) inRange++
    else if (v <= thresholds.high) elevated++
    else hyper++
  }

  return {
    severeHypo: (severeHypo / n) * 100,
    hypo: (hypo / n) * 100,
    inRange: (inRange / n) * 100,
    elevated: (elevated / n) * 100,
    hyper: (hyper / n) * 100,
  }
}

/**
 * TIR quality classification — clinical assessment.
 * @typedef {string} TirQuality
 * @enum {string}
 */
export type TirQuality = "excellent" | "good" | "needsImprovement" | "concerningHypo" | "concerningHyper"

/**
 * Assess glycemic control quality from TIR and variability.
 * Prioritizes hypo safety over hyper avoidance (per ADA guidelines).
 * @param {TirResult} tir - Time In Range percentages
 * @param {number} cv - Coefficient of Variation (%)
 * @returns {TirQuality} Quality assessment
 */
export function assessTirQuality(tir: TirResult, cv: number): TirQuality {
  if (tir.hypo + tir.severeHypo > 5) return "concerningHypo"
  if (tir.hyper > 25) return "concerningHyper"
  if (tir.inRange >= 70 && cv <= 36) return "excellent"
  if (tir.inRange >= 50) return "good"
  return "needsImprovement"
}

/**
 * Ambulatory Glucose Profile (AGP) — 15-minute time slot with percentile distribution.
 * @typedef {Object} AgpSlot
 * @property {number} timeMinutes - Time of day in minutes (0-1440, 15-min intervals)
 * @property {number} p10 - 10th percentile glucose (g/L)
 * @property {number} p25 - 25th percentile glucose (g/L)
 * @property {number} p50 - Median (50th percentile) glucose (g/L)
 * @property {number} p75 - 75th percentile glucose (g/L)
 * @property {number} p90 - 90th percentile glucose (g/L)
 */
export interface AgpSlot {
  timeMinutes: number
  p10: number
  p25: number
  p50: number
  p75: number
  p90: number
}

/**
 * Compute Ambulatory Glucose Profile — 96 slots (15-min intervals over 24h).
 * Groups readings by 15-minute slot then calculates percentiles.
 * @param {Array<{timestamp: Date, valueGl: number}>} entries - CGM entries with timestamps
 * @returns {AgpSlot[]} Array of 96 slots (one per 15-minute interval)
 */
export function computeAgp(
  entries: { timestamp: Date; valueGl: number }[],
): AgpSlot[] {
  // Group by 15-min slot (0-95)
  const slots: number[][] = Array.from({ length: 96 }, () => [])

  for (const entry of entries) {
    const minutes = entry.timestamp.getHours() * 60 + entry.timestamp.getMinutes()
    const slotIndex = Math.floor(minutes / 15)
    slots[slotIndex].push(entry.valueGl)
  }

  return slots.map((values, i) => {
    const sorted = [...values].sort((a, b) => a - b)
    return {
      timeMinutes: i * 15,
      p10: percentile(sorted, 10),
      p25: percentile(sorted, 25),
      p50: percentile(sorted, 50),
      p75: percentile(sorted, 75),
      p90: percentile(sorted, 90),
    }
  })
}

/**
 * Hypoglycemia episode — continuous period below threshold.
 * @typedef {Object} HypoEpisode
 * @property {Date} start - Episode start time
 * @property {Date} end - Episode end time
 * @property {number} duration - Duration in minutes
 * @property {number} nadir - Lowest glucose in episode (g/L)
 * @property {("level1" | "level2")} severity - level1 = low, level2 = severe low
 */
export interface HypoEpisode {
  start: Date
  end: Date
  duration: number // minutes
  nadir: number // lowest value in g/L
  severity: "level1" | "level2"
}

/**
 * Detect hypoglycemia episodes — 3+ consecutive readings below threshold, max 30-min gap.
 * Determines severity based on nadir (lowest glucose in episode).
 * @param {Array<{timestamp: Date, valueGl: number}>} entries - CGM entries (should be sorted)
 * @param {Object} thresholds - Hypo thresholds (low, veryLow) in g/L
 * @returns {HypoEpisode[]} Detected episodes with start, end, duration, nadir, severity
 */
export function detectHypoEpisodes(
  entries: { timestamp: Date; valueGl: number }[],
  thresholds: { low: number; veryLow: number },
): HypoEpisode[] {
  const MAX_GAP_MS = 30 * 60 * 1000
  const episodes: HypoEpisode[] = []
  let current: { start: Date; values: number[]; timestamps: Date[] } | null = null

  for (const entry of entries) {
    const isHypo = entry.valueGl < thresholds.low

    if (isHypo) {
      if (!current) {
        current = { start: entry.timestamp, values: [entry.valueGl], timestamps: [entry.timestamp] }
      } else {
        const gap = entry.timestamp.getTime() - current.timestamps[current.timestamps.length - 1].getTime()
        if (gap <= MAX_GAP_MS) {
          current.values.push(entry.valueGl)
          current.timestamps.push(entry.timestamp)
        } else {
          // Gap too large — close current and start new
          if (current.values.length >= 3) {
            episodes.push(buildEpisode(current, thresholds.veryLow))
          }
          current = { start: entry.timestamp, values: [entry.valueGl], timestamps: [entry.timestamp] }
        }
      }
    } else {
      if (current && current.values.length >= 3) {
        episodes.push(buildEpisode(current, thresholds.veryLow))
      }
      current = null
    }
  }

  // Close last episode
  if (current && current.values.length >= 2) {
    episodes.push(buildEpisode(current, thresholds.veryLow))
  }

  return episodes
}

/**
 * Build a HypoEpisode object from episode data.
 * @private
 * @param {Object} data - Episode tracking data (start, values, timestamps)
 * @param {number} veryLowThreshold - Severe hypo threshold for severity classification
 * @returns {HypoEpisode} Episode object
 */
function buildEpisode(
  data: { start: Date; values: number[]; timestamps: Date[] },
  veryLowThreshold: number,
): HypoEpisode {
  const end = data.timestamps[data.timestamps.length - 1]
  const nadir = Math.min(...data.values)
  return {
    start: data.start,
    end,
    duration: Math.round((end.getTime() - data.start.getTime()) / 60000),
    nadir,
    severity: nadir < veryLowThreshold ? "level2" : "level1",
  }
}

/**
 * CGM capture rate — percentage of expected readings successfully received.
 * Assumes 5-minute CGM interval (288 readings/day).
 * @param {number} entryCount - Actual readings received
 * @param {number} periodDays - Period length in days
 * @returns {number} Capture rate percentage (0-100, may exceed 100 if duplicates)
 */
export function cgmCaptureRate(entryCount: number, periodDays: number): number {
  const expectedPerDay = 288 // every 5 minutes
  const expected = expectedPerDay * periodDays
  if (expected === 0) return 0
  return (entryCount / expected) * 100
}
