/**
 * Test suite: Basal Configuration — GET, UPSERT, Pump Slots CRUD
 *
 * Clinical behavior tested:
 * - Retrieval of basal configuration with pump slots ordered by start time
 * - Upsert of basal configuration (create or update) with audit trail
 * - Creation of pump basal slots with time-of-day delivery rates
 * - Deletion of pump basal slots with audit trail
 *
 * Associated risks:
 * - Incorrect basal rate storage (out of 0.05-10.0 U/h range) could cause
 *   under/over-delivery of basal insulin
 * - Missing audit on basal config changes prevents tracing who modified
 *   critical insulin delivery parameters
 * - Overlapping pump slots could cause double-delivery in same time window
 *
 * Edge cases:
 * - getBasalConfig when no config exists (returns null)
 * - upsertBasalConfig creates new when none exists
 * - deletePumpSlot on non-existent slot (should throw)
 */
import { describe, it, expect, vi } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

import { insulinTherapyService } from "@/lib/services/insulin-therapy.service"

describe("insulinTherapyService — basal config", () => {
  describe("getBasalConfig", () => {
    it("returns config with pump slots", async () => {
      const mockConfig = {
        id: 1,
        settingsId: 10,
        configType: "pump",
        totalDailyDose: 24.5,
        pumpSlots: [
          { id: "uuid-1", startTime: new Date("1970-01-01T00:00:00Z"), endTime: new Date("1970-01-01T06:00:00Z"), rate: 0.8 },
          { id: "uuid-2", startTime: new Date("1970-01-01T06:00:00Z"), endTime: new Date("1970-01-01T12:00:00Z"), rate: 1.2 },
        ],
      }
      prismaMock.basalConfiguration.findUnique.mockResolvedValue(mockConfig as any)

      const result = await insulinTherapyService.getBasalConfig(10)

      expect(result).not.toBeNull()
      expect(result!.pumpSlots).toHaveLength(2)
      expect(result!.configType).toBe("pump")
    })

    it("returns null when no config", async () => {
      prismaMock.basalConfiguration.findUnique.mockResolvedValue(null)

      const result = await insulinTherapyService.getBasalConfig(999)
      expect(result).toBeNull()
    })
  })

  describe("upsertBasalConfig", () => {
    it("upserts config with audit log", async () => {
      const mockConfig = {
        id: 1,
        settingsId: 10,
        configType: "pump",
        totalDailyDose: 24.5,
      }

      const txMock = {
        basalConfiguration: { upsert: vi.fn().mockResolvedValue(mockConfig) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(txMock))

      const result = await insulinTherapyService.upsertBasalConfig(
        10,
        { settingsId: 10, configType: "pump", totalDailyDose: 24.5 } as any,
        1,
      )

      expect(result.configType).toBe("pump")
      expect(txMock.basalConfiguration.upsert).toHaveBeenCalled()
      expect(txMock.auditLog.create).toHaveBeenCalled()
    })

    it("injects settingsId server-side on CREATE — caller cannot override FK", async () => {
      // Regression guard: BasalConfigInput omits settingsId. The service must
      // always splat it from its own argument, even if a caller somehow passed
      // a different value (RBAC bypass attempt via FK injection).
      const createArg = vi.fn().mockResolvedValue({ id: 1, settingsId: 10 })
      const txMock = {
        basalConfiguration: {
          upsert: vi.fn().mockImplementation((args: any) => {
            createArg(args)
            return { id: 1, settingsId: 10, configType: "pump" }
          }),
        },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(txMock))

      await insulinTherapyService.upsertBasalConfig(
        10,
        { configType: "pump" },
        1,
      )

      const call = createArg.mock.calls[0][0]
      expect(call.where).toEqual({ settingsId: 10 })
      expect(call.create.settingsId).toBe(10)  // server injected
    })
  })

  describe("createPumpSlot", () => {
    it("creates a pump slot with audit log", async () => {
      const mockSlot = {
        id: "uuid-new",
        basalConfigId: 1,
        startTime: new Date("1970-01-01T08:00:00Z"),
        endTime: new Date("1970-01-01T12:00:00Z"),
        rate: 0.95,
      }

      const txMock = {
        pumpBasalSlot: {
          findMany: vi.fn().mockResolvedValue([]),
          create: vi.fn().mockResolvedValue(mockSlot),
        },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(txMock))

      const result = await insulinTherapyService.createPumpSlot(
        1,
        { startTime: "08:00", endTime: "12:00", rate: 0.95 },
        1,
      )

      expect(result.rate).toBe(0.95)
      expect(txMock.pumpBasalSlot.findMany).toHaveBeenCalled()
      expect(txMock.pumpBasalSlot.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          basalConfigId: 1,
          rate: 0.95,
        }),
      })
      // Audit resourceId uses "pump:<uuid>" prefix (matches isf:/icr:/basal: convention)
      expect(txMock.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ resourceId: "pump:uuid-new" }),
        }),
      )
    })

    it("rejects overlapping pump slots", async () => {
      const existingSlot = {
        startTime: new Date("1970-01-01T06:00:00Z"),
        endTime: new Date("1970-01-01T12:00:00Z"),
      }

      const txMock = {
        pumpBasalSlot: {
          findMany: vi.fn().mockResolvedValue([existingSlot]),
        },
        auditLog: { create: vi.fn() },
      }
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(txMock))

      await expect(
        insulinTherapyService.createPumpSlot(1, { startTime: "08:00", endTime: "14:00", rate: 0.8 }, 1),
      ).rejects.toThrow("overlaps")
    })
  })

  describe("deletePumpSlot", () => {
    it("deletes a pump slot with audit log", async () => {
      const txMock = {
        pumpBasalSlot: { delete: vi.fn().mockResolvedValue({}) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(txMock))

      const result = await insulinTherapyService.deletePumpSlot("uuid-1", 1)

      expect(result).toEqual({ deleted: true })
      expect(txMock.pumpBasalSlot.delete).toHaveBeenCalledWith({ where: { id: "uuid-1" } })
    })

    it("throws when slot does not exist", async () => {
      const txMock = {
        pumpBasalSlot: { delete: vi.fn().mockRejectedValue(new Error("Record not found")) },
        auditLog: { create: vi.fn() },
      }
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(txMock))

      await expect(insulinTherapyService.deletePumpSlot("nonexistent", 1)).rejects.toThrow("Record not found")
    })
  })
})
