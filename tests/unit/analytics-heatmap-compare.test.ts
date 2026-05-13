/**
 * Test suite: analyticsService — heatmap (US-2038) + compare (US-2039)
 *
 * Clinical behavior tested:
 * - 7×24 grid produced by `heatmap` always contains 168 cells, even when a
 *   slot has zero readings (cell.avgMgdl = null). This stability is required
 *   for the dashboard to align cells consistently in the UI.
 * - `compare` returns two contiguous windows of identical length with a
 *   numeric delta on TIR, GMI and average glucose — used to assess the
 *   effect of a therapeutic adjustment.
 *
 * Associated risks:
 * - Off-by-one on dayOfWeek (Sun=0 instead of Mon=0) would mis-align the
 *   heat-map header in a French clinical context.
 * - Confusing g/L and mg/dL in the heat-map would print a 100× error.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"
import { analyticsService } from "@/lib/services/analytics.service"

beforeEach(() => {
  prismaMock.auditLog.create.mockResolvedValue({} as any)
  prismaMock.cgmObjective.findUnique.mockResolvedValue(null)
})

describe("analyticsService.heatmap", () => {
  it("returns 168 cells with monday-first day ordering", async () => {
    // 2026-01-05 = Monday at 08:00 → dayOfWeek=0, hour=8
    const monday8h = new Date("2026-01-05T08:00:00Z")
    const entries = [
      { valueGl: 1.20, timestamp: monday8h },
      { valueGl: 1.30, timestamp: new Date(monday8h.getTime() + 5 * 60_000) },
    ]
    prismaMock.cgmEntry.findMany.mockResolvedValue(entries as any)

    const result = await analyticsService.heatmap(1, "7d", 1)
    expect(result.cells).toHaveLength(168)
    const mondayHour = monday8h.getUTCHours()
    const cell = result.cells.find((c) => c.dayOfWeek === 0 && c.hour === mondayHour)
    expect(cell).toBeDefined()
    expect(cell!.readingCount).toBeGreaterThanOrEqual(1)
    expect(cell!.avgMgdl).not.toBeNull()
  })

  it("leaves cells without readings as null", async () => {
    prismaMock.cgmEntry.findMany.mockResolvedValue([] as any)
    const result = await analyticsService.heatmap(1, "7d", 1)
    expect(result.cells.every((c) => c.avgMgdl === null && c.readingCount === 0)).toBe(true)
  })

  it("audits the read", async () => {
    prismaMock.cgmEntry.findMany.mockResolvedValue([] as any)
    await analyticsService.heatmap(42, "14d", 7)
    const calls = prismaMock.auditLog.create.mock.calls
    expect(calls.length).toBeGreaterThan(0)
    const last = calls[calls.length - 1][0].data as any
    expect(last.resource).toBe("ANALYTICS")
    expect(last.resourceId).toBe("42")
    expect(last.metadata).toMatchObject({ patientId: 42, kind: "heatmap" })
  })
})

describe("analyticsService.compare", () => {
  it("computes delta between previous and recent windows", async () => {
    // recent: average 1.4 g/L; previous: average 1.0 g/L → delta > 0
    const recent = Array.from({ length: 1000 }, () => ({ valueGl: 1.4 }))
    const previous = Array.from({ length: 1000 }, () => ({ valueGl: 1.0 }))
    prismaMock.cgmEntry.findMany
      .mockResolvedValueOnce(recent as any)
      .mockResolvedValueOnce(previous as any)

    const result = await analyticsService.compare(1, "14d", 1)
    expect(result.recent.readingCount).toBe(1000)
    expect(result.previous.readingCount).toBe(1000)
    expect(result.delta.averageGlucoseMgdl).not.toBeNull()
    expect(result.delta.averageGlucoseMgdl!).toBeGreaterThan(0)
  })

  it("returns null deltas when either window is empty", async () => {
    prismaMock.cgmEntry.findMany
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([{ valueGl: 1.2 }] as any)
    const result = await analyticsService.compare(1, "14d", 1)
    expect(result.delta.inRangePct).toBeNull()
    expect(result.delta.gmi).toBeNull()
    expect(result.delta.averageGlucoseMgdl).toBeNull()
  })
})
