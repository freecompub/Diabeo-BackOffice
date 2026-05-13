/**
 * Test suite: analyticsService — heatmap (US-2038) + compare (US-2039)
 *
 * Clinical behavior tested:
 * - 7×24 grid produced by `heatmap` always contains 168 cells, even when a
 *   slot has zero readings (cell.avgMgdl = null). Grouping is pinned to
 *   Europe/Paris so the result is independent of the server timezone.
 * - `compare` returns two contiguous half-open windows and a numeric delta
 *   on TIR, GMI and average glucose. A `captureWarning` is surfaced when
 *   either window is below the 70% CGM capture threshold.
 *
 * Associated risks:
 * - Off-by-one on dayOfWeek (Sun=0 instead of Mon=0) would mis-align the
 *   heat-map header in a French clinical context.
 * - Server timezone drift between staging and prod would silently shift the
 *   meal-time buckets.
 * - A clinician comparing windows with insufficient data without the warning
 *   could trust noisy deltas.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"
import { analyticsService } from "@/lib/services/analytics.service"

beforeEach(() => {
  prismaMock.auditLog.create.mockResolvedValue({} as any)
  prismaMock.cgmObjective.findUnique.mockResolvedValue(null)
})

describe("analyticsService.heatmap", () => {
  it("returns 168 cells with monday-first day ordering (Europe/Paris)", async () => {
    // 2026-01-05 08:00 UTC = Monday 09:00 Paris (winter, UTC+1)
    const monday8hUtc = new Date("2026-01-05T08:00:00Z")
    const entries = [
      { valueGl: 1.20, timestamp: monday8hUtc },
      { valueGl: 1.30, timestamp: new Date(monday8hUtc.getTime() + 5 * 60_000) },
    ]
    prismaMock.cgmEntry.findMany.mockResolvedValue(entries as any)

    const result = await analyticsService.heatmap(1, "7d", 1)
    expect(result.cells).toHaveLength(168)
    // dayOfWeek=0 (Monday), hour=9 in Paris winter time.
    const cell = result.cells.find((c) => c.dayOfWeek === 0 && c.hour === 9)
    expect(cell).toBeDefined()
    expect(cell!.readingCount).toBeGreaterThanOrEqual(1)
    expect(cell!.avgMgdl).not.toBeNull()
  })

  it("buckets a Sunday-23h Paris reading on dayOfWeek=6 hour=23", async () => {
    // 2026-01-04 22:00 UTC = Sunday 23:00 Paris (winter)
    const sun23pParis = new Date("2026-01-04T22:00:00Z")
    prismaMock.cgmEntry.findMany.mockResolvedValue([
      { valueGl: 1.20, timestamp: sun23pParis },
    ] as any)
    const result = await analyticsService.heatmap(1, "7d", 1)
    const cell = result.cells.find((c) => c.dayOfWeek === 6 && c.hour === 23)
    expect(cell!.readingCount).toBe(1)
  })

  it("leaves cells without readings as null", async () => {
    prismaMock.cgmEntry.findMany.mockResolvedValue([] as any)
    const result = await analyticsService.heatmap(1, "7d", 1)
    expect(result.cells.every((c) => c.avgMgdl === null && c.readingCount === 0)).toBe(true)
  })

  it("audits with patientId pivot + from/to metadata", async () => {
    prismaMock.cgmEntry.findMany.mockResolvedValue([] as any)
    await analyticsService.heatmap(42, "14d", 7)
    const calls = prismaMock.auditLog.create.mock.calls
    expect(calls.length).toBeGreaterThan(0)
    const last = calls[calls.length - 1][0].data as any
    expect(last.resource).toBe("ANALYTICS")
    expect(last.resourceId).toBe("42")
    expect(last.metadata).toMatchObject({ patientId: 42, kind: "heatmap" })
    expect(last.metadata.from).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(last.metadata.to).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})

describe("analyticsService.compare", () => {
  it("computes delta between previous and recent windows", async () => {
    // recent: average 1.4 g/L; previous: average 1.0 g/L → delta > 0
    const recent = Array.from({ length: 1000 }, () => ({
      valueGl: 1.4,
      timestamp: new Date(),
    }))
    const previous = Array.from({ length: 1000 }, () => ({
      valueGl: 1.0,
      timestamp: new Date(),
    }))
    prismaMock.cgmEntry.findMany
      .mockResolvedValueOnce(recent as any)
      .mockResolvedValueOnce(previous as any)

    const result = await analyticsService.compare(1, "14d", 1)
    expect(result.recent.readingCount).toBe(1000)
    expect(result.previous.readingCount).toBe(1000)
    expect(result.delta.averageGlucoseMgdl).not.toBeNull()
    expect(result.delta.averageGlucoseMgdl!).toBeGreaterThan(0)
  })

  it("flags captureWarning when a window is sub-sampled", async () => {
    // 14d × 24h × 12 readings/hour = 4032 expected; 70% threshold ≈ 2822.
    prismaMock.cgmEntry.findMany
      .mockResolvedValueOnce(Array.from({ length: 50 }, () => ({ valueGl: 1.2, timestamp: new Date() })) as any)
      .mockResolvedValueOnce(Array.from({ length: 3500 }, () => ({ valueGl: 1.2, timestamp: new Date() })) as any)

    const result = await analyticsService.compare(1, "14d", 1)
    expect(result.recent.captureWarning).toBe("insufficientCgmCapture")
    expect(result.previous.captureWarning).toBeUndefined()
  })

  it("returns null deltas when either window is empty", async () => {
    prismaMock.cgmEntry.findMany
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([{ valueGl: 1.2, timestamp: new Date() }] as any)
    const result = await analyticsService.compare(1, "14d", 1)
    expect(result.delta.inRangePct).toBeNull()
    expect(result.delta.gmi).toBeNull()
    expect(result.delta.averageGlucoseMgdl).toBeNull()
  })

  it("audits with full window metadata for forensics", async () => {
    prismaMock.cgmEntry.findMany
      .mockResolvedValue([] as any)
    await analyticsService.compare(42, "14d", 7)
    const last = prismaMock.auditLog.create.mock.calls[prismaMock.auditLog.create.mock.calls.length - 1][0].data as any
    expect(last.metadata.recentFrom).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(last.metadata.previousFrom).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})

describe("analyticsService skipAudit option", () => {
  it("glycemicProfile + agp suppress audit when skipAudit=true", async () => {
    prismaMock.cgmEntry.findMany.mockResolvedValue([] as any)
    prismaMock.auditLog.create.mockResolvedValue({} as any)
    const before = prismaMock.auditLog.create.mock.calls.length
    await analyticsService.glycemicProfile(1, "14d", 1, undefined, { skipAudit: true })
    await analyticsService.agp(1, "14d", 1, undefined, { skipAudit: true })
    expect(prismaMock.auditLog.create.mock.calls.length).toBe(before)
  })
})
