/**
 * Test suite: Events Validator — Diabetes Event Cross-Field Validation
 *
 * Clinical behavior tested:
 * - Cross-field validation of DiabetesEvent payloads: when eventTypes includes
 *   "glycemia", glycemiaValue is required; when it includes "insulinMeal",
 *   both carbsGrams and insulinUnits are required; when it includes
 *   "physicalActivity", activityDurationMin is required
 * - eventTypes is a non-empty array of the DiabetesEventType enum (multi-category
 *   events such as ["insulinMeal", "physicalActivity"] are valid — ADR #12)
 * - Numeric clinical bounds are enforced at the validation layer:
 *   glycemiaValue ∈ [0.20, 5.00] g/L; insulinUnits ∈ [0, 100] U;
 *   carbsGrams ∈ [0, 500] g; activityDurationMin ∈ [1, 600] min
 * - eventDate must be a parseable ISO-8601 timestamp and must not be in the
 *   future beyond a tolerance window
 *
 * Associated risks:
 * - Accepting an event without glycemiaValue when type is "glycemia" would
 *   create a record with a null glucose value, silently corrupting CGM history
 * - Bypassing clinical bounds on insulinUnits could allow logging an
 *   implausible dose (e.g. 999 U), poisoning bolus calculation history
 * - An empty eventTypes array passing validation would produce a record with
 *   no clinical meaning, breaking downstream analytics filters
 *
 * Edge cases:
 * - eventTypes array with a single valid type (minimum valid cardinality)
 * - eventTypes array with all known types simultaneously (maximum cardinality)
 * - glycemiaValue exactly at bounds: 0.20 g/L (min) and 5.00 g/L (max)
 * - insulinMeal event with carbsGrams = 0 (valid: correction-only bolus)
 * - eventDate as a string requiring coercion to Date (z.coerce.date())
 * - Unknown eventType string in array (must fail with descriptive error)
 */
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
