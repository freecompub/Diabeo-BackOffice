import { z } from "zod"

export const diabetesEventSchema = z.object({
  eventDate: z.string().datetime(),
  eventTypes: z.array(z.enum([
    "glycemia", "insulinMeal", "physicalActivity", "context", "occasional",
  ])).min(1),
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
  comment: z.string().max(1000).optional(),
}).superRefine((data, ctx) => {
  if (data.eventTypes.includes("glycemia") && data.glycemiaValue === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["glycemiaValue"],
      message: "glycemiaValue required when eventTypes includes glycemia",
    })
  }
  if (data.eventTypes.includes("insulinMeal") && data.carbohydrates === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["carbohydrates"],
      message: "carbohydrates required when eventTypes includes insulinMeal",
    })
  }
  if (data.eventTypes.includes("physicalActivity")) {
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
  if (data.eventTypes.includes("context") && !data.contextType) {
    ctx.addIssue({
      code: "custom",
      path: ["contextType"],
      message: "contextType required when eventTypes includes context",
    })
  }
})

export type DiabetesEventInput = z.infer<typeof diabetesEventSchema>
