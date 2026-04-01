/**
 * Pure statistical functions for glycemic analytics.
 * All glucose values are in g/L unless stated otherwise.
 */

/** Convert g/L to mg/dL */
export function glToMgdl(gl: number): number {
  return gl * 100
}

/** Glucose Management Indicator (GMI) — preferred over eA1c per 2019 consensus */
export function glucoseManagementIndicator(avgGlucoseMgdl: number): number {
  return 3.31 + 0.02392 * avgGlucoseMgdl
}

/** Mean of numeric array */
export function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

/** Standard deviation with Bessel's correction */
export function stddev(values: number[]): number {
  if (values.length < 2) return 0
  const m = mean(values)
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

/** Coefficient of Variation (%) */
export function coefficientOfVariation(values: number[]): number {
  const m = mean(values)
  if (m === 0) return 0
  return (stddev(values) / m) * 100
}

/** Percentile (linear interpolation) */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  if (sorted.length === 1) return sorted[0]
  const idx = (p / 100) * (sorted.length - 1)
  const lower = Math.floor(idx)
  const upper = Math.ceil(idx)
  if (lower === upper) return sorted[lower]
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower)
}

/** CGM objectives thresholds */
export interface CgmThresholds {
  veryLow: number
  low: number
  ok: number
  high: number
}

/** Time In Range — 5 zones (percentages) */
export interface TirResult {
  severeHypo: number
  hypo: number
  inRange: number
  elevated: number
  hyper: number
}

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

/** TIR quality assessment */
export type TirQuality = "excellent" | "good" | "needsImprovement" | "concerningHypo" | "concerningHyper"

export function assessTirQuality(tir: TirResult, cv: number): TirQuality {
  if (tir.hypo + tir.severeHypo > 5) return "concerningHypo"
  if (tir.hyper > 25) return "concerningHyper"
  if (tir.inRange >= 70 && cv <= 36) return "excellent"
  if (tir.inRange >= 50) return "good"
  return "needsImprovement"
}

/** AGP profile — percentiles per time slot */
export interface AgpSlot {
  timeMinutes: number
  p10: number
  p25: number
  p50: number
  p75: number
  p90: number
}

/** Compute AGP with 15-minute slots over 24h (96 slots) */
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

/** Hypoglycemia episode */
export interface HypoEpisode {
  start: Date
  end: Date
  duration: number // minutes
  nadir: number // lowest value in g/L
  severity: "level1" | "level2"
}

/** Detect hypoglycemia episodes: 3+ consecutive readings below threshold (≥15min for 5-min CGM), max 30min gap */
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
          if (current.values.length >= 2) {
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

/** CGM capture rate — percentage of expected readings received */
export function cgmCaptureRate(entryCount: number, periodDays: number): number {
  const expectedPerDay = 288 // every 5 minutes
  const expected = expectedPerDay * periodDays
  if (expected === 0) return 0
  return (entryCount / expected) * 100
}
