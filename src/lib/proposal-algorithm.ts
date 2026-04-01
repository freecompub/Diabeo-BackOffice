/**
 * Adjustment proposal algorithm — pure functions.
 * Analyzes CGM + insulin data to generate ISF/ICR/basal adjustment proposals.
 */
import type { AdjustableParameter, AdjustmentReason, ConfidenceLevel } from "@prisma/client"

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

const MAX_CHANGE_PERCENT = 20 // ±20% cap

/** Determine confidence level from event count */
export function getConfidenceLevel(eventCount: number): ConfidenceLevel {
  if (eventCount > 10) return "high"
  if (eventCount >= 6) return "medium"
  return "low"
}

/** Clamp change percentage to ±20% */
export function clampChangePercent(percent: number): number {
  return Math.max(-MAX_CHANGE_PERCENT, Math.min(MAX_CHANGE_PERCENT, percent))
}

/** Apply clamped percentage to current value */
export function computeProposedValue(currentValue: number, changePercent: number): number {
  const clamped = clampChangePercent(changePercent)
  return Math.round(currentValue * (1 + clamped / 100) * 10000) / 10000
}

/**
 * Analyze ISF effectiveness — compare post-correction glucose vs target.
 * Returns a proposal if systematic over/under-correction detected.
 */
export function analyzeIsfSlot(
  slot: { startHour: number; endHour: number; sensitivityFactorGl: number },
  corrections: { postGlucoseGl: number; targetGl: number }[],
): ProposalCandidate | null {
  if (corrections.length < 3) return null

  const avgPost = corrections.reduce((s, c) => s + c.postGlucoseGl, 0) / corrections.length
  const avgTarget = corrections.reduce((s, c) => s + c.targetGl, 0) / corrections.length

  if (avgTarget === 0) return null

  // If post-correction glucose is consistently above target → ISF too low (needs increase)
  // If below target → ISF too high (needs decrease)
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
 * Analyze ICR effectiveness — compare post-meal glucose vs target.
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

  const reason: AdjustmentReason = clampedChange < 0 ? "icrTooLow" : "icrTooHigh"

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
 * Analyze basal rate — fasting glucose trends.
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
