import { describe, it, expect, vi } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

import { deviceService } from "@/lib/services/device.service"

describe("deviceService", () => {
  describe("list", () => {
    it("returns devices for patient", async () => {
      prismaMock.patientDevice.findMany.mockResolvedValue([{ id: 1, brand: "Dexcom" }] as any)
      prismaMock.auditLog.create.mockResolvedValue({} as any)
      const result = await deviceService.list(1, 1)
      expect(result).toHaveLength(1)
    })
  })

  describe("create", () => {
    it("creates device when under max", async () => {
      prismaMock.patientDevice.count.mockResolvedValue(3)
      const mockTx = {
        patientDevice: { create: vi.fn().mockResolvedValue({ id: 4, brand: "Dexcom" }) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      const result = await deviceService.create(1, { brand: "Dexcom", category: "cgm" as any }, 1)
      expect(result.id).toBe(4)
    })

    it("throws when max devices reached", async () => {
      prismaMock.patientDevice.count.mockResolvedValue(9)
      await expect(deviceService.create(1, {}, 1)).rejects.toThrow("maxDevicesReached")
    })
  })

  describe("delete", () => {
    it("deletes device", async () => {
      const mockTx = {
        patientDevice: {
          findFirst: vi.fn().mockResolvedValue({ id: 1, patientId: 1 }),
          delete: vi.fn().mockResolvedValue({}),
        },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)
      const result = await deviceService.delete(1, 1, 1)
      expect(result.deleted).toBe(true)
    })

    it("throws for non-existent device", async () => {
      const mockTx = { patientDevice: { findFirst: vi.fn().mockResolvedValue(null) } }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)
      await expect(deviceService.delete(999, 1, 1)).rejects.toThrow("deviceNotFound")
    })
  })

  describe("getSyncStatus", () => {
    it("returns sync entries", async () => {
      prismaMock.deviceDataSync.findMany.mockResolvedValue([])
      const result = await deviceService.getSyncStatus(1)
      expect(result).toEqual([])
    })
  })
})
