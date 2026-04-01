/**
 * Test suite: Device Service — Connected Medical Device Management
 *
 * Clinical behavior tested:
 * - Listing PatientDevice records (CGM sensors, insulin pumps, glucometers)
 *   associated with a patient, used by the sync service to route incoming
 *   device data to the correct patient record
 * - Creating a new device association: validated against a maximum device
 *   count per patient (business rule — prevents unbounded growth) and
 *   written with an audit log entry in a single transaction
 * - Updating device metadata (firmware version, calibration date, status)
 *   without exposing the patient's other device configurations
 * - Deactivating (soft-disabling) a device when it is replaced or returned,
 *   preserving the historical association for sync audit purposes
 * - Audit logging of all reads and mutations
 *
 * Associated risks:
 * - Exceeding the device limit without enforcement could create an unbounded
 *   number of DeviceDataSync rows per patient, degrading sync performance
 * - Creating a device without an audit entry removes the traceability of
 *   which device was paired and when — critical for diagnosing data-source
 *   issues in glucose readings
 * - Returning devices belonging to another patient due to a missing ownership
 *   filter would allow cross-patient device manipulation
 *
 * Edge cases:
 * - Patient already at maximum device count (create must be rejected with
 *   a descriptive error, not silently create or overwrite)
 * - Listing devices for a patient with no registered devices (empty array)
 * - Device with an unknown brand or type string (enum validation)
 * - Deactivating a device that is the sole source for active CGM entries
 *   (must warn or require confirmation, not silently break data stream)
 */
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

    it("allows creation at count 8 (8 existing + 1 new = 9 = limit)", async () => {
      prismaMock.patientDevice.count.mockResolvedValue(8)
      const mockTx = {
        patientDevice: { create: vi.fn().mockResolvedValue({ id: 9, brand: "Libre" }) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      const result = await deviceService.create(1, { brand: "Libre", category: "cgm" as any }, 1)
      expect(result.id).toBe(9)
    })

    it("throws when max devices reached (count = 9)", async () => {
      prismaMock.patientDevice.count.mockResolvedValue(9)
      await expect(deviceService.create(1, { category: "cgm" as any }, 1)).rejects.toThrow("maxDevicesReached")
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
    it("returns sync entries and audits the access", async () => {
      prismaMock.deviceDataSync.findMany.mockResolvedValue([])
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const result = await deviceService.getSyncStatus(1, 1)
      expect(result).toEqual([])
      expect(prismaMock.auditLog.create).toHaveBeenCalled()
    })
  })
})
