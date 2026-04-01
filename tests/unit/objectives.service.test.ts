import { describe, it, expect, vi } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

import { objectivesService, getCgmDefaults } from "@/lib/services/objectives.service"

describe("objectivesService", () => {
  describe("getCgmDefaults", () => {
    it("returns standard defaults for DT1", () => {
      const defaults = getCgmDefaults("DT1")
      expect(defaults.veryLow).toBe(0.54)
      expect(defaults.low).toBe(0.70)
      expect(defaults.ok).toBe(1.80)
      expect(defaults.high).toBe(2.50)
    })

    it("returns standard defaults for DT2", () => {
      const defaults = getCgmDefaults("DT2")
      expect(defaults.ok).toBe(1.80)
    })

    it("returns tighter defaults for GD (gestational diabetes)", () => {
      const defaults = getCgmDefaults("GD")
      expect(defaults.ok).toBe(1.40)
      expect(defaults.high).toBe(2.00)
      expect(defaults.low).toBe(0.63)
    })

    it("returns standard defaults when pathology is undefined", () => {
      const defaults = getCgmDefaults(undefined)
      expect(defaults.ok).toBe(1.80)
    })

    it("all defaults have correct threshold ordering", () => {
      for (const pathology of ["DT1", "DT2", "GD", undefined] as const) {
        const d = getCgmDefaults(pathology as "DT1" | "DT2" | "GD" | undefined)
        expect(d.veryLow).toBeLessThan(d.low)
        expect(d.low).toBeLessThan(d.ok)
        expect(d.ok).toBeLessThan(d.high)
        expect(d.titrLow).toBeLessThan(d.titrHigh)
      }
    })
  })

  describe("getAll", () => {
    it("returns objectives with CGM defaults when no record exists", async () => {
      prismaMock.glycemiaObjective.findMany.mockResolvedValue([])
      prismaMock.cgmObjective.findUnique.mockResolvedValue(null)
      prismaMock.annexObjective.findUnique.mockResolvedValue(null)
      prismaMock.patient.findUnique.mockResolvedValue({ pathology: "DT1" } as never)
      prismaMock.auditLog.create.mockResolvedValue({} as never)

      const result = await objectivesService.getAll(1, 1)

      expect(result.glycemia).toEqual([])
      expect(result.cgm).toEqual(getCgmDefaults("DT1"))
      expect(result.annex).toBeNull()
    })

    it("returns existing CGM record when available", async () => {
      const cgmRecord = { id: 1, patientId: 1, veryLow: 0.50, low: 0.65, ok: 1.60, high: 2.20, titrLow: 0.65, titrHigh: 1.60 }
      prismaMock.glycemiaObjective.findMany.mockResolvedValue([])
      prismaMock.cgmObjective.findUnique.mockResolvedValue(cgmRecord as never)
      prismaMock.annexObjective.findUnique.mockResolvedValue(null)
      prismaMock.patient.findUnique.mockResolvedValue({ pathology: "DT1" } as never)
      prismaMock.auditLog.create.mockResolvedValue({} as never)

      const result = await objectivesService.getAll(1, 1)
      expect(result.cgm).toEqual(cgmRecord)
    })
  })

  describe("updateCgm", () => {
    it("upserts CGM objectives in transaction", async () => {
      const input = { veryLow: 0.54, low: 0.70, ok: 1.80, high: 2.50, titrLow: 0.70, titrHigh: 1.80 }
      const mockTx = {
        cgmObjective: { upsert: vi.fn().mockResolvedValue({ id: 1, patientId: 1, ...input }) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation(async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx))

      const result = await objectivesService.updateCgm(1, input, 1)

      expect(mockTx.cgmObjective.upsert).toHaveBeenCalled()
      expect(result.patientId).toBe(1)
    })
  })

  describe("updateAnnex", () => {
    it("upserts annex objectives in transaction", async () => {
      const input = { objectiveHba1c: 7.0, objectiveWalk: 30 }
      const mockTx = {
        annexObjective: { upsert: vi.fn().mockResolvedValue({ id: 1, patientId: 1, ...input }) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation(async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx))

      const result = await objectivesService.updateAnnex(1, input, 1)

      expect(mockTx.annexObjective.upsert).toHaveBeenCalled()
      expect(result.patientId).toBe(1)
    })
  })
})
