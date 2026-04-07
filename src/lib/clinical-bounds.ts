/**
 * Clinical safety bounds for insulin therapy calculations.
 *
 * SINGLE SOURCE OF TRUTH — used by both insulin.service.ts and
 * insulin-therapy.service.ts. Never duplicate these constants.
 *
 * References:
 * - ADA Standards of Medical Care in Diabetes (2025)
 * - 1800 Rule for ISF range
 * - Consensus on max single bolus (25U safety cap)
 *
 * @see docs/clinical-logic/bolus-calculation.md
 */

export const CLINICAL_BOUNDS = {
  /** ISF in g/L per unit — widened for insulin-resistant T2D */
  ISF_GL_MIN: 0.10,
  ISF_GL_MAX: 1.00,
  /** ISF in mg/dL per unit — 1800 Rule range */
  ISF_MGDL_MIN: 10,
  ISF_MGDL_MAX: 100,
  /** ICR (Insulin-to-Carb Ratio) in grams per unit — widened for pediatric + resistant */
  ICR_MIN: 3.0,
  ICR_MAX: 30.0,
  /** Basal rate in U/h — 5.0 max (10 U/h = 240 U/day, dangerous) */
  BASAL_MIN: 0.05,
  BASAL_MAX: 5.0,
  /** Glucose target range in mg/dL */
  TARGET_MIN_MGDL: 60,
  TARGET_MAX_MGDL: 250,
  /** Maximum single bolus dose — safety cap */
  MAX_SINGLE_BOLUS: 25.0,
  /** Insulin action duration range in hours (rapid-acting pharmacokinetics) */
  INSULIN_ACTION_MIN: 3.5,
  INSULIN_ACTION_MAX: 5.0,
  /** Pump basal increment in U/h */
  PUMP_BASAL_INCREMENT: 0.05,
} as const

export type ClinicalBounds = typeof CLINICAL_BOUNDS
