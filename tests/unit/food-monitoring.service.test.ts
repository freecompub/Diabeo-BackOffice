/**
 * Test suite : food-monitoring.service (Groupe 10 Batch E — 3 US backend).
 *
 * Couvre :
 *  - US-2248 foodJournalQuery : ordering + photoCount + audit emission
 *  - US-2251 adherenceQuery : score composite, distinct days, bolus
 *    coverage, no-meal fallback
 *  - US-2253 glycemiaMealContextQuery : pre/post avg, sample counts,
 *    empty meals → empty list
 */
import { describe, it, expect, beforeEach } from "vitest"
import { Prisma, DiabetesEventType } from "@prisma/client"
import { prismaMock } from "../helpers/prisma-mock"
import {
  foodJournalQuery, adherenceQuery, glycemiaMealContextQuery,
} from "@/lib/services/food-monitoring.service"

beforeEach(() => {
  prismaMock.auditLog.create.mockResolvedValue({} as any)
})

// ─── US-2248 ────────────────────────────────────────────────────

describe("foodJournalQuery (US-2248)", () => {
  it("maps photoCount via _count + emits audit row", async () => {
    prismaMock.diabetesEvent.findMany.mockResolvedValue([
      {
        id: "e1", eventDate: new Date("2026-05-14T12:00:00Z"),
        carbohydrates: new Prisma.Decimal(45),
        bolusDose: new Prisma.Decimal(4.5),
        comment: "lunch", validatedAt: null,
        _count: { mealPhotos: 2 },
      },
    ] as any)
    const out = await foodJournalQuery.forPatient(7, 9)
    expect(out).toHaveLength(1)
    expect(out[0]!.photoCount).toBe(2)
    expect(out[0]!.carbohydrates).toBe(45)
    expect(out[0]!.bolusDose).toBe(4.5)
    const meta = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(meta.metadata.kind).toBe("food.journal")
    expect(meta.metadata.patientId).toBe(7)
  })

  it("filters by insulinMeal eventType (has operator)", async () => {
    prismaMock.diabetesEvent.findMany.mockResolvedValue([] as any)
    await foodJournalQuery.forPatient(7, 9)
    const call = prismaMock.diabetesEvent.findMany.mock.calls[0]![0]!
    expect((call.where as any).eventTypes).toEqual({
      has: DiabetesEventType.insulinMeal,
    })
  })
})

// ─── US-2251 ────────────────────────────────────────────────────

describe("adherenceQuery (US-2251)", () => {
  it("computes regularity + bolusCoverage + composite score", async () => {
    // 15 distinct days with events (= 50% regularity over 30d window)
    const dates = Array.from({ length: 15 }, (_, i) => ({
      eventDate: new Date(`2026-05-${String(i + 1).padStart(2, "0")}T08:00:00Z`),
    }))
    prismaMock.diabetesEvent.findMany.mockResolvedValue(dates as any)
    prismaMock.diabetesEvent.count
      .mockResolvedValueOnce(10) // totalMeals
      .mockResolvedValueOnce(8)  // mealsWithBolus
    const out = await adherenceQuery.forPatient(7, 9)
    expect(out.daysWithEntry).toBe(15)
    expect(out.regularityPercent).toBe(50)
    expect(out.totalMeals).toBe(10)
    expect(out.mealsWithBolus).toBe(8)
    expect(out.bolusCoveragePercent).toBe(80)
    // 0.6 * 50 + 0.4 * 80 = 30 + 32 = 62
    expect(out.score).toBe(62)
  })

  it("falls back to regularity-only score when no meals", async () => {
    prismaMock.diabetesEvent.findMany.mockResolvedValue([
      { eventDate: new Date("2026-05-14T08:00:00Z") },
    ] as any)
    prismaMock.diabetesEvent.count
      .mockResolvedValueOnce(0) // totalMeals
      .mockResolvedValueOnce(0)
    const out = await adherenceQuery.forPatient(7, 9)
    expect(out.bolusCoveragePercent).toBeNull()
    // 1 day / 30 = 3.3% rounded to 3
    expect(out.score).toBe(3)
  })

  it("handles empty event history (score 0)", async () => {
    prismaMock.diabetesEvent.findMany.mockResolvedValue([] as any)
    prismaMock.diabetesEvent.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
    const out = await adherenceQuery.forPatient(7, 9)
    expect(out.daysWithEntry).toBe(0)
    expect(out.score).toBe(0)
  })
})

// ─── US-2253 ────────────────────────────────────────────────────

describe("glycemiaMealContextQuery (US-2253)", () => {
  it("returns [] when no meals in window", async () => {
    prismaMock.diabetesEvent.findMany.mockResolvedValue([] as any)
    const out = await glycemiaMealContextQuery.forPatient(7, 9)
    expect(out).toEqual([])
    expect(prismaMock.cgmEntry.findMany).not.toHaveBeenCalled()
  })

  it("computes pre/post averages with sample counts", async () => {
    const meal = new Date("2026-05-14T12:00:00Z")
    prismaMock.diabetesEvent.findMany.mockResolvedValue([
      {
        id: "m1", eventDate: meal,
        carbohydrates: new Prisma.Decimal(40),
        bolusDose: new Prisma.Decimal(4),
      },
    ] as any)
    // CGM : 2 pre-meal readings (1.0 g/L, 1.2 g/L), 3 post (1.6, 1.8, 1.4)
    prismaMock.cgmEntry.findMany.mockResolvedValue([
      { timestamp: new Date(meal.getTime() - 30 * 60_000), valueGl: new Prisma.Decimal(1.0) },
      { timestamp: new Date(meal.getTime() - 90 * 60_000), valueGl: new Prisma.Decimal(1.2) },
      { timestamp: new Date(meal.getTime() + 30 * 60_000), valueGl: new Prisma.Decimal(1.6) },
      { timestamp: new Date(meal.getTime() + 60 * 60_000), valueGl: new Prisma.Decimal(1.8) },
      { timestamp: new Date(meal.getTime() + 90 * 60_000), valueGl: new Prisma.Decimal(1.4) },
    ] as any)
    const out = await glycemiaMealContextQuery.forPatient(7, 9)
    expect(out).toHaveLength(1)
    expect(out[0]!.preMealAvgGl).toBeCloseTo(1.10, 2)
    expect(out[0]!.preMealSamples).toBe(2)
    expect(out[0]!.postMealAvgGl).toBeCloseTo(1.60, 2)
    expect(out[0]!.postMealSamples).toBe(3)
  })

  it("returns null avg when no CGM samples in window", async () => {
    const meal = new Date("2026-05-14T12:00:00Z")
    prismaMock.diabetesEvent.findMany.mockResolvedValue([
      { id: "m1", eventDate: meal, carbohydrates: null, bolusDose: null },
    ] as any)
    prismaMock.cgmEntry.findMany.mockResolvedValue([] as any)
    const out = await glycemiaMealContextQuery.forPatient(7, 9)
    expect(out[0]!.preMealAvgGl).toBeNull()
    expect(out[0]!.postMealAvgGl).toBeNull()
    expect(out[0]!.preMealSamples).toBe(0)
    expect(out[0]!.postMealSamples).toBe(0)
  })
})
