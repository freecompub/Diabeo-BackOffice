import { describe, it, expect } from "vitest"
import { diabetesEventSchema } from "@/lib/validators/events"

describe("diabetesEventSchema", () => {
  const validBase = {
    eventDate: "2026-04-01T10:00:00Z",
    eventTypes: ["glycemia"],
    glycemiaValue: 120,
  }

  it("validates a simple glycemia event", () => {
    const result = diabetesEventSchema.safeParse(validBase)
    expect(result.success).toBe(true)
  })

  it("requires glycemiaValue when eventTypes includes glycemia", () => {
    const result = diabetesEventSchema.safeParse({
      eventDate: "2026-04-01T10:00:00Z",
      eventTypes: ["glycemia"],
    })
    expect(result.success).toBe(false)
  })

  it("requires carbohydrates when eventTypes includes insulinMeal", () => {
    const result = diabetesEventSchema.safeParse({
      eventDate: "2026-04-01T10:00:00Z",
      eventTypes: ["insulinMeal"],
    })
    expect(result.success).toBe(false)
  })

  it("requires activityType and activityDuration for physicalActivity", () => {
    const result = diabetesEventSchema.safeParse({
      eventDate: "2026-04-01T10:00:00Z",
      eventTypes: ["physicalActivity"],
    })
    expect(result.success).toBe(false)

    const valid = diabetesEventSchema.safeParse({
      eventDate: "2026-04-01T10:00:00Z",
      eventTypes: ["physicalActivity"],
      activityType: "walking",
      activityDuration: 30,
    })
    expect(valid.success).toBe(true)
  })

  it("requires contextType for context events", () => {
    const result = diabetesEventSchema.safeParse({
      eventDate: "2026-04-01T10:00:00Z",
      eventTypes: ["context"],
    })
    expect(result.success).toBe(false)

    const valid = diabetesEventSchema.safeParse({
      eventDate: "2026-04-01T10:00:00Z",
      eventTypes: ["context"],
      contextType: "stress",
    })
    expect(valid.success).toBe(true)
  })

  it("validates composite event (glycemia + insulinMeal)", () => {
    const result = diabetesEventSchema.safeParse({
      eventDate: "2026-04-01T12:00:00Z",
      eventTypes: ["glycemia", "insulinMeal"],
      glycemiaValue: 150,
      carbohydrates: 60,
      bolusDose: 5.5,
    })
    expect(result.success).toBe(true)
  })

  it("requires at least one eventType", () => {
    const result = diabetesEventSchema.safeParse({
      eventDate: "2026-04-01T10:00:00Z",
      eventTypes: [],
    })
    expect(result.success).toBe(false)
  })

  it("validates glycemiaValue range (20-600 mg/dL)", () => {
    const tooLow = diabetesEventSchema.safeParse({
      ...validBase, glycemiaValue: 10,
    })
    expect(tooLow.success).toBe(false)

    const tooHigh = diabetesEventSchema.safeParse({
      ...validBase, glycemiaValue: 700,
    })
    expect(tooHigh.success).toBe(false)
  })

  it("validates HbA1c range (4.0-14.0)", () => {
    const tooLow = diabetesEventSchema.safeParse({
      ...validBase, hba1c: 2.0,
    })
    expect(tooLow.success).toBe(false)
  })
})
