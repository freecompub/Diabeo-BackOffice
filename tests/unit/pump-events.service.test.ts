/**
 * Test suite: Pump Events — CREATE and DELETE operations
 *
 * Clinical behavior tested:
 * - Creation of pump events (alarms, suspends, resets, bolus deliveries)
 *   linked to a patient record with audit trail
 * - Deletion of pump events with audit trail
 * - Audit logging for both create and delete operations (HDS compliance)
 *
 * Associated risks:
 * - Missing audit on pump event creation/deletion would break HDS traceability
 * - Creating pump events for wrong patient = cross-patient data contamination
 *
 * Edge cases:
 * - Create with optional JSON data field (undefined and present)
 * - Delete non-existent event (should throw)
 */
import { describe, it, expect, vi } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

import { glycemiaService } from "@/lib/services/glycemia.service"

describe("glycemiaService — pump events", () => {
  describe("createPumpEvent", () => {
    it("creates a pump event with audit log", async () => {
      const mockEvent = {
        id: 1,
        patientId: 10,
        timestamp: new Date("2026-04-01T08:00:00Z"),
        eventType: "alarm",
        data: { code: "LOW_RESERVOIR" },
        createdAt: new Date(),
      }

      const txMock = {
        pumpEvent: { create: vi.fn().mockResolvedValue(mockEvent) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(txMock))

      const result = await glycemiaService.createPumpEvent(
        10,
        { timestamp: new Date("2026-04-01T08:00:00Z"), eventType: "alarm", data: { code: "LOW_RESERVOIR" } },
        1,
      )

      expect(result).toEqual(mockEvent)
      expect(txMock.pumpEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          patientId: 10,
          eventType: "alarm",
        }),
      })
      expect(txMock.auditLog.create).toHaveBeenCalled()
    })

    it("creates a pump event without optional data field", async () => {
      const mockEvent = {
        id: 2,
        patientId: 10,
        timestamp: new Date("2026-04-01T09:00:00Z"),
        eventType: "suspend",
        data: null,
        createdAt: new Date(),
      }

      const txMock = {
        pumpEvent: { create: vi.fn().mockResolvedValue(mockEvent) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(txMock))

      const result = await glycemiaService.createPumpEvent(
        10,
        { timestamp: new Date("2026-04-01T09:00:00Z"), eventType: "suspend" },
        1,
      )

      expect(result.eventType).toBe("suspend")
    })
  })

  describe("deletePumpEvent", () => {
    it("deletes a pump event with audit log", async () => {
      const txMock = {
        pumpEvent: { delete: vi.fn().mockResolvedValue({}) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(txMock))

      const result = await glycemiaService.deletePumpEvent(1, 1)

      expect(result).toEqual({ deleted: true })
      expect(txMock.pumpEvent.delete).toHaveBeenCalledWith({ where: { id: 1 } })
      expect(txMock.auditLog.create).toHaveBeenCalled()
    })

    it("throws when event does not exist", async () => {
      const txMock = {
        pumpEvent: { delete: vi.fn().mockRejectedValue(new Error("Record not found")) },
        auditLog: { create: vi.fn() },
      }
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(txMock))

      await expect(glycemiaService.deletePumpEvent(999, 1)).rejects.toThrow("Record not found")
    })
  })
})
