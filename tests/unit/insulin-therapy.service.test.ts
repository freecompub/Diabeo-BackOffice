import { describe, it, expect } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

import { insulinTherapyService } from "@/lib/services/insulin-therapy.service"

describe("insulinTherapyService", () => {
  describe("getSettings", () => {
    it("returns settings with all relations", async () => {
      prismaMock.insulinTherapySettings.findUnique.mockResolvedValue({
        id: 1,
        patientId: 1,
        bolusInsulinBrand: "humalog",
        deliveryMethod: "pump",
        sensitivityFactors: [],
        carbRatios: [],
      } as any)
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const result = await insulinTherapyService.getSettings(1, 1)
      expect(result).not.toBeNull()
      expect(result!.bolusInsulinBrand).toBe("humalog")
    })

    it("returns null when no settings", async () => {
      prismaMock.insulinTherapySettings.findUnique.mockResolvedValue(null)
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const result = await insulinTherapyService.getSettings(1, 1)
      expect(result).toBeNull()
    })
  })

  describe("getBolusLogs", () => {
    it("returns bolus logs within date range", async () => {
      prismaMock.bolusCalculationLog.findMany.mockResolvedValue([
        { id: "log-1", patientId: 1, recommendedDose: 5.5 },
      ] as any)
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const result = await insulinTherapyService.getBolusLogs(
        1, new Date("2026-03-01"), new Date("2026-03-31"), 1,
      )
      expect(result).toHaveLength(1)
    })
  })

  describe("getBolusLogById", () => {
    it("returns a specific bolus log", async () => {
      prismaMock.bolusCalculationLog.findUnique.mockResolvedValue({
        id: "log-1", patientId: 1,
      } as any)
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const result = await insulinTherapyService.getBolusLogById("log-1", 1)
      expect(result).not.toBeNull()
    })

    it("returns null for non-existent log", async () => {
      prismaMock.bolusCalculationLog.findUnique.mockResolvedValue(null)

      const result = await insulinTherapyService.getBolusLogById("bad-id", 1)
      expect(result).toBeNull()
    })
  })
})
