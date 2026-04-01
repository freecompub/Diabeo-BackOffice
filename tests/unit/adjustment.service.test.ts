import { describe, it, expect, vi } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

import { adjustmentService } from "@/lib/services/adjustment.service"

describe("adjustmentService", () => {
  describe("summary", () => {
    it("returns counts by status", async () => {
      prismaMock.adjustmentProposal.count
        .mockResolvedValueOnce(3)  // pending
        .mockResolvedValueOnce(10) // accepted
        .mockResolvedValueOnce(2)  // rejected
        .mockResolvedValueOnce(1)  // expired

      const result = await adjustmentService.summary(1)
      expect(result).toEqual({ pending: 3, accepted: 10, rejected: 2, expired: 1, total: 16 })
    })
  })

  describe("accept", () => {
    it("accepts a pending proposal", async () => {
      const mockTx = {
        adjustmentProposal: {
          findUnique: vi.fn().mockResolvedValue({
            id: "p1", patientId: 1, status: "pending",
            parameterType: "insulinSensitivityFactor",
            proposedValue: 0.55, timeSlotStartHour: 8,
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        insulinSensitivityFactor: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      const result = await adjustmentService.accept("p1", 2, true)
      expect(result.accepted).toBe(true)
      expect(result.applied).toBe(true)
      expect(mockTx.insulinSensitivityFactor.updateMany).toHaveBeenCalled()
    })

    it("throws for non-pending proposal", async () => {
      const mockTx = {
        adjustmentProposal: {
          findUnique: vi.fn().mockResolvedValue({ id: "p1", status: "accepted" }),
        },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      await expect(adjustmentService.accept("p1", 2, false))
        .rejects.toThrow("proposalNotFound")
    })
  })

  describe("reject", () => {
    it("rejects a pending proposal", async () => {
      const mockTx = {
        adjustmentProposal: {
          findUnique: vi.fn().mockResolvedValue({ id: "p1", status: "pending" }),
          update: vi.fn().mockResolvedValue({}),
        },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      const result = await adjustmentService.reject("p1", 2)
      expect(result.rejected).toBe(true)
    })
  })

  describe("list", () => {
    it("lists proposals with filters", async () => {
      prismaMock.adjustmentProposal.findMany.mockResolvedValue([])
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const result = await adjustmentService.list(1, {
        status: "pending",
        parameterType: "insulinSensitivityFactor",
        from: new Date("2026-01-01"),
        to: new Date("2026-03-31"),
      }, 1)
      expect(result).toEqual([])
    })

    it("lists without filters", async () => {
      prismaMock.adjustmentProposal.findMany.mockResolvedValue([])
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const result = await adjustmentService.list(1, {}, 1)
      expect(result).toEqual([])
    })
  })

  describe("createManual", () => {
    it("creates manual proposal in transaction", async () => {
      const mockTx = {
        adjustmentProposal: { create: vi.fn().mockResolvedValue({ id: "p1", status: "pending" }) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      const result = await adjustmentService.createManual({
        patientId: 1,
        parameterType: "insulinSensitivityFactor",
        currentValue: 0.5,
        proposedValue: 0.55,
        changePercent: 10,
        confidence: "high",
        reason: "isfTooLow",
        supportingEvents: 12,
      } as any, 2)

      expect(result.id).toBe("p1")
    })
  })

  describe("accept with ICR apply", () => {
    it("applies ICR change when applyImmediately", async () => {
      const mockTx = {
        adjustmentProposal: {
          findUnique: vi.fn().mockResolvedValue({
            id: "p2", patientId: 1, status: "pending",
            parameterType: "insulinToCarbRatio",
            proposedValue: 12.0, carbRatioSlotStart: 12,
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        carbRatio: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      const result = await adjustmentService.accept("p2", 2, true)
      expect(result.applied).toBe(true)
      expect(mockTx.carbRatio.updateMany).toHaveBeenCalled()
    })
  })

  describe("accept with basal apply", () => {
    it("applies basal rate change when applyImmediately", async () => {
      const mockTx = {
        adjustmentProposal: {
          findUnique: vi.fn().mockResolvedValue({
            id: "p3", patientId: 1, status: "pending",
            parameterType: "basalRate",
            proposedValue: 0.85, pumpBasalSlotId: "slot-1",
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        pumpBasalSlot: { update: vi.fn().mockResolvedValue({}) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      const result = await adjustmentService.accept("p3", 2, true)
      expect(result.applied).toBe(true)
      expect(mockTx.pumpBasalSlot.update).toHaveBeenCalled()
    })
  })

  describe("accept without apply", () => {
    it("accepts without applying changes", async () => {
      const mockTx = {
        adjustmentProposal: {
          findUnique: vi.fn().mockResolvedValue({
            id: "p4", patientId: 1, status: "pending",
            parameterType: "insulinSensitivityFactor",
            proposedValue: 0.55, timeSlotStartHour: 8,
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      const result = await adjustmentService.accept("p4", 2, false)
      expect(result.accepted).toBe(true)
      expect(result.applied).toBe(false)
    })
  })
})
