import { describe, it, expect, vi } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

import { glycemiaService } from "@/lib/services/glycemia.service"

describe("glycemiaService", () => {
  describe("getCgmEntries", () => {
    it("returns CGM entries within date range", async () => {
      const entries = [{ id: 1n, patientId: 1, valueGl: 1.2, timestamp: new Date() }]
      prismaMock.cgmEntry.findMany.mockResolvedValue(entries as any)
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const from = new Date("2026-03-01")
      const to = new Date("2026-03-15")
      const result = await glycemiaService.getCgmEntries(1, from, to, 1)

      expect(result).toHaveLength(1)
      expect(prismaMock.cgmEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ patientId: 1 }),
        }),
      )
    })

    it("throws when period exceeds 30 days", async () => {
      const from = new Date("2026-01-01")
      const to = new Date("2026-03-01")

      await expect(glycemiaService.getCgmEntries(1, from, to, 1))
        .rejects.toThrow("Period cannot exceed 30 days")
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
      prismaMock.averageData.findMany.mockResolvedValue([
        { id: 1, patientId: 1, periodType: "current", mealType: "breakfast" },
        { id: 2, patientId: 1, periodType: "7d", mealType: "breakfast" },
      ] as any)

      const result = await glycemiaService.getAverageData(1)
      expect(result.current).toHaveLength(1)
      expect(result.avg7d).toHaveLength(1)
      expect(result.avg30d).toHaveLength(0)
    })
  })

  describe("getInsulinFlow", () => {
    it("returns insulin flow entries", async () => {
      prismaMock.insulinFlowEntry.findMany.mockResolvedValue([])
      const result = await glycemiaService.getInsulinFlow(1, new Date(), new Date())
      expect(result).toEqual([])
    })
  })

  describe("getPumpEvents", () => {
    it("returns pump events with optional type filter", async () => {
      prismaMock.pumpEvent.findMany.mockResolvedValue([])
      const result = await glycemiaService.getPumpEvents(1, new Date(), new Date(), "alarm")
      expect(result).toEqual([])
    })
  })
})
