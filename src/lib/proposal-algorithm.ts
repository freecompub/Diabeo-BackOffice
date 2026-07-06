/**
 * @module proposal-algorithm
 * @description Adjustment proposal algorithm — pure functions for ISF/ICR/basal analysis.
 * Analyzes post-correction/meal glucose to detect systematic over/under-correction.
 * Proposes changes with confidence level based on event count.
 * All changes clamped to ±20% to prevent dangerous adjustments.
 * @see CLAUDE.md#adjustment-proposals — Proposal generation algorithm
 */

import type { AdjustableParameter, AdjustmentReason, ConfidenceLevel, DoseMoment } from "@prisma/client"
import { CLINICAL_BOUNDS, BGM_CARNET } from "@/lib/clinical-bounds"
import { GLYCEMIA_THRESHOLDS_MGDL } from "@/lib/glycemia-thresholds"

/** Seuil d'hypo SÉVÈRE en g/L (source unique mg/dL ÷ 100). */
const SEVERE_HYPO_GL = GLYCEMIA_THRESHOLDS_MGDL.SEVERE_HYPO / 100

/**
 * Adjustment proposal candidate — suggested parameter change with confidence.
 * @typedef {Object} ProposalCandidate
 * @property {AdjustableParameter} parameterType - Parameter to adjust (ISF, ICR, or basal)
 * @property {AdjustmentReason} reason - Why this adjustment (too low/high/etc.)
 * @property {number} currentValue - Current parameter value
 * @property {number} proposedValue - Suggested new value
 * @property {number} changePercent - Change magnitude (%-20 to +20)
 * @property {ConfidenceLevel} confidence - Evidence strength (low/medium/high)
 * @property {number} supportingEvents - Number of events supporting this proposal
 * @property {number} totalEventsConsidered - Total events analyzed
 * @property {number} [timeSlotStartHour] - Hour slot (for ISF/ICR proposals)
 * @property {number} [timeSlotEndHour] - Hour slot end
 * @property {number} [averageObservedValue] - Average post-correction glucose (for analysis)
 */
export interface ProposalCandidate {
  parameterType: AdjustableParameter
  reason: AdjustmentReason
  currentValue: number
  proposedValue: number
  changePercent: number
  confidence: ConfidenceLevel
  supportingEvents: number
  totalEventsConsidered: number
  timeSlotStartHour?: number
  timeSlotEndHour?: number
  averageObservedValue?: number
}

/** Max change magnitude per proposal — safety cap (source unique : `CLINICAL_BOUNDS`, US-2651). */
const MAX_CHANGE_PERCENT = CLINICAL_BOUNDS.MAX_CHANGE_PERCENT // ±20%

/**
 * Determine confidence level from supporting event count.
 * Higher event count = more confidence in the recommendation.
 * @param {number} eventCount - Number of supporting events
 * @returns {("low" | "medium" | "high")} Confidence level
 */
export function getConfidenceLevel(eventCount: number): ConfidenceLevel {
  if (eventCount > 10) return "high"
  if (eventCount >= 6) return "medium"
  return "low"
}

/**
 * Clamp change percentage to ±20% safety limit.
 * Prevents overly aggressive adjustments that could harm patient.
 * @param {number} percent - Proposed change percentage
 * @returns {number} Clamped percentage in range [-20, +20]
 */
export function clampChangePercent(percent: number): number {
  return Math.max(-MAX_CHANGE_PERCENT, Math.min(MAX_CHANGE_PERCENT, percent))
}

/**
 * Compute proposed parameter value — apply clamped percentage to current value.
 * Formula: newValue = currentValue * (1 + changePercent/100), rounded to 4 decimals.
 * @param {number} currentValue - Current parameter value
 * @param {number} changePercent - Proposed change percentage (will be clamped)
 * @returns {number} Proposed value (4 decimal places)
 */
export function computeProposedValue(currentValue: number, changePercent: number): number {
  const clamped = clampChangePercent(changePercent)
  return Math.round(currentValue * (1 + clamped / 100) * 10000) / 10000
}

/**
 * Analyze ISF (insulin sensitivity factor) effectiveness for a time slot.
 * Detects systematic over/under-correction from post-correction glucose patterns.
 * Only proposes if 3+ events AND change is meaningful (> 2%).
 * @param {Object} slot - ISF slot configuration (startHour, endHour, sensitivityFactorGl)
 * @param {Array<{postGlucoseGl: number, targetGl: number}>} corrections - Post-correction readings and targets
 * @returns {ProposalCandidate | null} Proposal if detected, null otherwise
 */
export function analyzeIsfSlot(
  slot: { startHour: number; endHour: number; sensitivityFactorGl: number },
  corrections: { postGlucoseGl: number; targetGl: number }[],
): ProposalCandidate | null {
  if (corrections.length < 3) return null

  const avgPost = corrections.reduce((s, c) => s + c.postGlucoseGl, 0) / corrections.length
  const avgTarget = corrections.reduce((s, c) => s + c.targetGl, 0) / corrections.length

  if (avgTarget === 0) return null

  // ISF est un DÉNOMINATEUR (dose = (BG−cible)/ISF), d'où le sign-flip (×−100) :
  // - post-correction AU-DESSUS de la cible → correction trop faible → ISF trop HAUT → BAISSE (isfTooHigh) ;
  // - EN DESSOUS (sur-correction) → ISF trop BAS → HAUSSE (isfTooLow).
  // (Validé medical US-2651 ; l'ancien commentaire était inversé.)
  const errorPercent = ((avgPost - avgTarget) / avgTarget) * -100
  const clampedChange = clampChangePercent(errorPercent)

  // Only propose if change is meaningful (> 2%)
  if (Math.abs(clampedChange) < 2) return null

  const reason: AdjustmentReason = clampedChange > 0 ? "isfTooLow" : "isfTooHigh"

  return {
    parameterType: "insulinSensitivityFactor",
    reason,
    currentValue: slot.sensitivityFactorGl,
    proposedValue: computeProposedValue(slot.sensitivityFactorGl, clampedChange),
    changePercent: Math.round(clampedChange * 100) / 100,
    confidence: getConfidenceLevel(corrections.length),
    supportingEvents: corrections.length,
    totalEventsConsidered: corrections.length,
    timeSlotStartHour: slot.startHour,
    timeSlotEndHour: slot.endHour,
    averageObservedValue: Math.round(avgPost * 10000) / 10000,
  }
}

/**
 * Analyze ICR (insulin-to-carb ratio) effectiveness for a time slot.
 * Detects systematic post-meal glucose over/under-coverage from carb ratio.
 * Only proposes if 3+ meals AND change is meaningful (> 2%).
 * @param {Object} slot - ICR slot configuration (startHour, endHour, gramsPerUnit)
 * @param {Array<{postGlucoseGl: number, targetGl: number}>} meals - Post-meal readings and targets
 * @returns {ProposalCandidate | null} Proposal if detected, null otherwise
 */
export function analyzeIcrSlot(
  slot: { startHour: number; endHour: number; gramsPerUnit: number },
  meals: { postGlucoseGl: number; targetGl: number }[],
): ProposalCandidate | null {
  if (meals.length < 3) return null

  const avgPost = meals.reduce((s, m) => s + m.postGlucoseGl, 0) / meals.length
  const avgTarget = meals.reduce((s, m) => s + m.targetGl, 0) / meals.length

  if (avgTarget === 0) return null

  // Post-meal glucose above target → ICR too high (give more insulin per gram → lower ICR)
  // Below target → ICR too low (give less insulin → raise ICR)
  const errorPercent = ((avgPost - avgTarget) / avgTarget) * -100
  const clampedChange = clampChangePercent(errorPercent)

  if (Math.abs(clampedChange) < 2) return null

  // ICR est un DÉNOMINATEUR (bolus = glucides/ICR) : baisser l'ICR = plus d'insuline/gramme.
  // Post-repas AU-DESSUS de la cible → bolus trop faible → ICR trop HAUT → BAISSE (icrTooHigh) ;
  // EN DESSOUS → ICR trop BAS → HAUSSE (icrTooLow). (Correction validée medical US-2651 : les
  // libellés étaient inversés — la DIRECTION était correcte, seul le `reason` affiché était faux.)
  const reason: AdjustmentReason = clampedChange < 0 ? "icrTooHigh" : "icrTooLow"

  return {
    parameterType: "insulinToCarbRatio",
    reason,
    currentValue: slot.gramsPerUnit,
    proposedValue: computeProposedValue(slot.gramsPerUnit, clampedChange),
    changePercent: Math.round(clampedChange * 100) / 100,
    confidence: getConfidenceLevel(meals.length),
    supportingEvents: meals.length,
    totalEventsConsidered: meals.length,
    timeSlotStartHour: slot.startHour,
    timeSlotEndHour: slot.endHour,
    averageObservedValue: Math.round(avgPost * 10000) / 10000,
  }
}

/**
 * Analyze basal rate effectiveness from fasting glucose trends.
 * Detects systematic overnight drift (rising = too low, falling = too high).
 * Only proposes if 3+ fasting values AND change is meaningful (> 2%).
 * @param {number[]} fastingValues - Pre-breakfast glucose readings (g/L)
 * @param {number} targetGl - Fasting glucose target (g/L)
 * @param {number} currentRate - Current basal rate (U/h)
 * @returns {ProposalCandidate | null} Proposal if detected, null otherwise
 */
export function analyzeBasalTrend(
  fastingValues: number[],
  targetGl: number,
  currentRate: number,
): ProposalCandidate | null {
  if (fastingValues.length < 3) return null

  const avgFasting = fastingValues.reduce((s, v) => s + v, 0) / fastingValues.length
  if (targetGl === 0) return null

  const errorPercent = ((avgFasting - targetGl) / targetGl) * 100
  const clampedChange = clampChangePercent(errorPercent)

  if (Math.abs(clampedChange) < 2) return null

  const reason: AdjustmentReason = clampedChange > 0 ? "basalTooLow" : "basalTooHigh"

  return {
    parameterType: "basalRate",
    reason,
    currentValue: currentRate,
    proposedValue: computeProposedValue(currentRate, clampedChange),
    changePercent: Math.round(clampedChange * 100) / 100,
    confidence: getConfidenceLevel(fastingValues.length),
    supportingEvents: fastingValues.length,
    totalEventsConsidered: fastingValues.length,
    averageObservedValue: Math.round(avgFasting * 10000) / 10000,
  }
}

/**
 * Analyse une DOSE FIXE (mode b, US-2651) pour un **moment** (matin/midi/soir/nuit) à partir de
 * la tendance glycémique du carnet (BGM). Une dose fixe est une dose **directe** (comme la basale,
 * PAS un dénominateur) : glycémie systématiquement **au-dessus** de la cible → dose **trop basse**
 * → hausse ; **en dessous** → dose **trop haute** → baisse.
 *
 * **Titration LENTE et bornée** (jamais auto-appliquée — ADR #13) :
 *  - ≥ `BGM_CARNET.MIN_READINGS_PER_MOMENT` relevés requis, sinon `null` (bruit).
 *  - Variation = le **plus petit** de ± `FIXED_DOSE_MAX_CHANGE_PERCENT` (10 %) et
 *    ± `FIXED_DOSE_MAX_DELTA_U` (2 U).
 *  - **Plancher** absolu `FIXED_DOSE_MIN` (0,5 U). Arrondi à l'incrément délivrable
 *    `FIXED_DOSE_DELIVERY_INCREMENT_U` (0,5 U) ; pas nul → aucune proposition (non actionnable).
 *  - **Interdits** (hors périmètre de cette fonction pure) : convertir une dose fixe en
 *    basal-bolus, créer un ISF/ICR ex nihilo — l'appelant ne route ici qu'un patient `fixedDose`.
 *
 * @param slot Dose fixe courante du moment (`{ moment, valueU }`).
 * @param readings Relevés glycémiques du moment (`postGlucoseGl` vs `targetGl`, g/L).
 * @returns Proposition `fixedDose` bornée, ou `null` si insuffisant/non actionnable.
 */
export function analyzeFixedDose(
  slot: { moment: DoseMoment; valueU: number },
  readings: { postGlucoseGl: number; targetGl: number }[],
): ProposalCandidate | null {
  if (readings.length < BGM_CARNET.MIN_READINGS_PER_MOMENT) return null
  // Fail-closed sur l'entrée : dose courante invalide/nulle (sinon `changePercent` = Infinity,
  // et une dose < plancher n'est pas une base de titration valide). Validé medical US-2651.
  if (!Number.isFinite(slot.valueU) || slot.valueU < CLINICAL_BOUNDS.FIXED_DOSE_MIN) return null

  const avgPost = readings.reduce((s, r) => s + r.postGlucoseGl, 0) / readings.length
  const avgTarget = readings.reduce((s, r) => s + r.targetGl, 0) / readings.length
  if (avgTarget === 0) return null

  // Dose directe : au-dessus de la cible → hausser la dose (sign +, comme la basale).
  const errorPercent = ((avgPost - avgTarget) / avgTarget) * 100
  const pctCap = CLINICAL_BOUNDS.FIXED_DOSE_MAX_CHANGE_PERCENT
  const pctClamped = Math.max(-pctCap, Math.min(pctCap, errorPercent))
  const deltaFromPct = (slot.valueU * pctClamped) / 100
  // Le plus petit des deux caps : ± FIXED_DOSE_MAX_DELTA_U (U) ET ± pctCap %.
  const absCap = CLINICAL_BOUNDS.FIXED_DOSE_MAX_DELTA_U
  const delta = Math.max(-absCap, Math.min(absCap, deltaFromPct))

  // Plancher absolu + arrondi à l'incrément délivrable (demi-unité).
  const inc = CLINICAL_BOUNDS.FIXED_DOSE_DELIVERY_INCREMENT_U
  const proposedRaw = Math.max(CLINICAL_BOUNDS.FIXED_DOSE_MIN, slot.valueU + delta)
  const proposedValue = Math.round(proposedRaw / inc) * inc
  const effectiveDelta = proposedValue - slot.valueU

  // Pas arrondi nul (< incrément délivrable) → non actionnable.
  if (Math.abs(effectiveDelta) < inc) return null

  // Garde HYPO (validé medical US-2651) : ne JAMAIS proposer une HAUSSE si un relevé du moment
  // est en hypo SÉVÈRE — la moyenne peut masquer une hypo intermittente, et hausser une dose fixe
  // (sans logique de correction pour rattraper) serait la direction dangereuse. La BAISSE reste
  // permise (sens sûr).
  if (effectiveDelta > 0 && readings.some((r) => r.postGlucoseGl < SEVERE_HYPO_GL)) return null

  const reason: AdjustmentReason = effectiveDelta > 0 ? "fixedDoseTooLow" : "fixedDoseTooHigh"

  return {
    parameterType: "fixedDose",
    reason,
    currentValue: slot.valueU,
    proposedValue,
    changePercent: Math.round((effectiveDelta / slot.valueU) * 100 * 100) / 100,
    confidence: getConfidenceLevel(readings.length),
    supportingEvents: readings.length,
    totalEventsConsidered: readings.length,
    averageObservedValue: Math.round(avgPost * 10000) / 10000,
  }
}
