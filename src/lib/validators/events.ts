/**
 * @module validators/events
 * @description Zod schema for diabetes event validation.
 * Implements cross-field validation: certain eventTypes require specific fields (glycemia, carbs, activity details, context type).
 * Events can have multiple eventTypes (array).
 * @see CLAUDE.md#validators — Zod patterns and error handling
 */

import { z } from "zod"
import { DiabetesEventType } from "@prisma/client"

/**
 * Derive all event types from Prisma enum — avoids duplication.
 * Ensures schema stays in sync with database.
 * @constant
 */
const EVENT_TYPES = Object.values(DiabetesEventType) as [DiabetesEventType, ...DiabetesEventType[]]

/**
 * Zod schema for diabetes event creation/update.
 * Uses superRefine() for cross-field validation based on eventTypes.
 * - glycemia in eventTypes → glycemiaValue required
 * - insulinMeal in eventTypes → carbohydrates required
 * - physicalActivity in eventTypes → activityType AND activityDuration required
 * - context in eventTypes → contextType required
 * @constant
 * @type {z.ZodSchema}
 */
export const diabetesEventSchema = z.object({
  eventDate: z.string().datetime(),
  eventTypes: z.array(z.enum(EVENT_TYPES)).min(1),
  glycemiaValue: z.number().min(20).max(600).optional(),
  carbohydrates: z.number().min(0).optional(),
  bolusDose: z.number().min(0).max(25).optional(),
  basalDose: z.number().min(0).max(10).optional(),
  activityType: z.enum([
    "walking", "running", "cycling", "swimming", "gym",
    "sports", "housework", "gardening", "yoga", "other",
  ]).optional(),
  activityDuration: z.number().int().positive().max(600).optional(),
  contextType: z.enum([
    "stress", "illness", "menstruation", "alcohol", "travel",
    "sleepIssue", "medication", "hypoglycemia", "hyperglycemia", "other",
  ]).optional(),
  weight: z.number().positive().max(300).optional(),
  hba1c: z.number().min(4.0).max(14.0).optional(),
  ketones: z.number().min(0).max(20).optional(),
  systolicPressure: z.number().int().min(50).max(300).optional(),
  diastolicPressure: z.number().int().min(20).max(200).optional(),
  comment: z.string().min(1).max(1000).optional(),
}).superRefine((data, ctx) => {
  if (data.eventTypes.includes("glycemia" as DiabetesEventType) && data.glycemiaValue === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["glycemiaValue"],
      message: "glycemiaValue required when eventTypes includes glycemia",
    })
  }
  if (data.eventTypes.includes("insulinMeal" as DiabetesEventType) && data.carbohydrates === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["carbohydrates"],
      message: "carbohydrates required when eventTypes includes insulinMeal",
    })
  }
  if (data.eventTypes.includes("physicalActivity" as DiabetesEventType)) {
    if (!data.activityType) {
      ctx.addIssue({
        code: "custom",
        path: ["activityType"],
        message: "activityType required when eventTypes includes physicalActivity",
      })
    }
    if (data.activityDuration === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["activityDuration"],
        message: "activityDuration required when eventTypes includes physicalActivity",
      })
    }
  }
  if (data.eventTypes.includes("context" as DiabetesEventType) && !data.contextType) {
    ctx.addIssue({
      code: "custom",
      path: ["contextType"],
      message: "contextType required when eventTypes includes context",
    })
  }
})

/**
 * Type-safe diabetes event input — inferred from schema.
 * Used in eventsService.create(), eventsService.update() parameters.
 * @typedef {z.infer<typeof diabetesEventSchema>} DiabetesEventInput
 */
export type DiabetesEventInput = z.infer<typeof diabetesEventSchema>
