/**
 * Glycemia display thresholds (mg/dL) — SINGLE SOURCE OF TRUTH.
 *
 * Consensus glycemic zones (ADA / ATTD international consensus on CGM metrics):
 *   critical-low <40 | severe-hypo <54 | target 70–180 | severe-hyper >250 | critical-high >400
 *
 * These are DISPLAY DEFAULTS, distinct from the insulin-therapy SAFETY bounds in
 * `clinical-bounds.ts` (which gate dosing config). Per-patient `GlucoseTarget`
 * (Prisma) may override target low/high at runtime — these constants are the
 * fallback when no patient-specific target is set.
 *
 * Named by CLINICAL MEANING (not by component field name) on purpose: two
 * consumer shapes historically reused the same field names with different
 * meanings (e.g. `high` = 180 in GlycemiaValue vs 250 in charts/types). Each
 * consumer maps these unambiguous constants into its own shape — no magic
 * numbers, no drift.
 *
 * IMPORTANT: dependency-free (no imports) → safe to import from client AND
 * server components. Do not add imports that pull Prisma/Redis/services here.
 *
 * @see src/lib/clinical-bounds.ts — insulin dosing safety bounds (different concern)
 * @see prisma/schema.prisma model GlucoseTarget — per-patient overrides
 */

export const GLYCEMIA_THRESHOLDS_MGDL = {
  /** < this → critical (immediate danger). */
  CRITICAL_LOW: 40,
  /** < this → severe hypoglycemia. */
  SEVERE_HYPO: 54,
  /** in-range lower bound (severe→/hypo below). */
  TARGET_LOW: 70,
  /** in-range upper bound (hyper above). */
  TARGET_HIGH: 180,
  /** > this → severe hyperglycemia. */
  SEVERE_HYPER: 250,
  /** > this → critical (immediate danger). */
  CRITICAL_HIGH: 400,
} as const

export type GlycemiaThresholdsMgdl = typeof GLYCEMIA_THRESHOLDS_MGDL
