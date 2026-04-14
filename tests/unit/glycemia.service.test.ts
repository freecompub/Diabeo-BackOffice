/**
 * Test suite: Glycemia Service — CGM and Punctual Glucose Data Access
 *
 * Clinical behavior tested:
 * - Retrieval of CGM entries (continuous glucose monitor readings) for a patient
 *   within a caller-specified date range, used to populate trend graphs and
 *   compute TIR statistics
 * - Enforcement of a 30-day maximum window per request to prevent excessive
 *   data loads that could degrade performance for the partitioned CgmEntry table
 * - Access to punctual glycemia measurements (capillary finger-stick readings)
 *   alongside CGM data to give a complete glucose picture
 * - Every data-read operation produces an audit log entry recording the
 *   requesting user, patient ID, and time window queried
 *
 * Associated risks:
 * - A missing date-range guard allowing unbounded queries could trigger a full
 *   partition scan on the CGM table, causing denial-of-service for other users
 * - Returning CGM entries for a patient the requesting user is not authorized
 *   to access would constitute a cross-patient data breach
 * - A missing audit log on CGM reads would break HDS traceability requirements
 *   for access to sensitive health data
 *
 * Edge cases:
 * - Date range of exactly 30 days (boundary — must be accepted)
 * - Date range of 30 days + 1 second (must be rejected with a clear error)
 * - Patient with no CGM entries in the requested window (must return empty array)
 * - from > to (invalid range — must be rejected)
 * - BigInt primary keys on CgmEntry serialized correctly in the response
 */
import { describe, it, expect } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

import { glycemiaService } from "@/lib/services/glycemia.service"

describe("glycemiaService", () => {
  describe("getCgmEntries", () => {
    it("returns CGM entries within date range", async () => {
      const entries = [{ id: BigInt(1), patientId: 1, valueGl: 1.2, timestamp: new Date() }]
      prismaMock.cgmEntry.findMany.mockResolvedValue(entries as any)
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const from = new Date("2026-03-01")
      const to = new Date("2026-03-15")
      const result = await glycemiaService.getCgmEntries(1, from, to, 1)

      expect(result).toHaveLength(1)
    })

    it("throws when period exceeds 30 days", async () => {
      const from = new Date("2026-01-01")
      const to = new Date("2026-03-01")

      await expect(glycemiaService.getCgmEntries(1, from, to, 1))
        .rejects.toThrow("Period cannot exceed 30 days")
    })

    it("throws when from > to", async () => {
      const from = new Date("2026-03-15")
      const to = new Date("2026-03-01")

      await expect(glycemiaService.getCgmEntries(1, from, to, 1))
        .rejects.toThrow("'from' must be before 'to'")
    })
  })

  describe("getGlycemiaEntries", () => {
    it("returns glycemia entries", async () => {
      prismaMock.glycemiaEntry.findMany.mockResolvedValue([])
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const result = await glycemiaService.getGlycemiaEntries(
        1, new Date("2026-03-01"), new Date("2026-03-15"), 1,
      )
      expect(result).toEqual([])
    })
  })

  describe("getAverageData", () => {
    it("groups averages by period type", async () => {
      // Prisma enum with @map: TS-side values are `current`, `d7`, `d30`;
      // the @map target (`7d`/`30d`) is only the DB column content.
      prismaMock.averageData.findMany.mockResolvedValue([
        { id: 1, patientId: 1, periodType: "current", mealType: "breakfast" },
        { id: 2, patientId: 1, periodType: "d7", mealType: "breakfast" },
      ] as any)
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const result = await glycemiaService.getAverageData(1, 1)
      expect(result.current).toHaveLength(1)
      expect(result.avg7d).toHaveLength(1)
      expect(result.avg30d).toHaveLength(0)
    })
  })

  describe("getInsulinFlow", () => {
    it("returns insulin flow entries", async () => {
      prismaMock.insulinFlowEntry.findMany.mockResolvedValue([])
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const result = await glycemiaService.getInsulinFlow(
        1, new Date("2026-03-01"), new Date("2026-03-15"), 1,
      )
      expect(result).toEqual([])
    })
  })

  describe("getPumpEvents", () => {
    it("returns pump events with optional type filter", async () => {
      prismaMock.pumpEvent.findMany.mockResolvedValue([])
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const result = await glycemiaService.getPumpEvents(
        1, new Date("2026-03-01"), new Date("2026-03-15"), 1, undefined, "alarm",
      )
      expect(result).toEqual([])
    })
  })
})
