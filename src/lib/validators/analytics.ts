/**
 * @module validators/analytics
 * @description Shared Zod schemas for analytics routes — eliminates the
 * verbatim copy of the period regex across `agp`, `glycemic-profile`,
 * `time-in-range`, `hypoglycemia`, `heatmap`, `compare`, and `agp/pdf`.
 *
 * Two schemas:
 *  - `periodSchema(maxDays, defaultPeriod)` for "Nd" strings (max 90/45 etc.)
 *  - `windowDaysSchema(maxDays, defaultDays)` for integer day counts used by
 *    population routes.
 */

import { z } from "zod"

export function periodSchema(maxDays: number, defaultPeriod = "14d") {
  return z
    .string()
    .regex(/^[1-9]\d{0,1}d$/)
    .refine((s) => parseInt(s, 10) <= maxDays, {
      message: `Period max ${maxDays} days`,
    })
    .default(defaultPeriod)
}

export function windowDaysSchema(maxDays: number, defaultDays = 14) {
  return z.coerce.number().int().min(1).max(maxDays).default(defaultDays)
}
