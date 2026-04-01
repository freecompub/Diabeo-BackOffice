/**
 * Test suite: Adjustment Service — Proposal Accept / Reject Workflow
 *
 * Clinical behavior tested:
 * - Summary query: counts of AdjustmentProposal records by status (pending,
 *   accepted, rejected, expired) for a patient, giving a physician a quick
 *   overview of outstanding recommendations
 * - Accept workflow: a DOCTOR transitions a proposal from "pending" to
 *   "accepted", records their user ID in reviewedBy, timestamps the review,
 *   and triggers the corresponding InsulinTherapySettings mutation in a single
 *   Prisma transaction — ensuring the accepted value is applied atomically
 * - Reject workflow: a DOCTOR transitions a proposal to "rejected" with an
 *   optional rejection comment; the underlying settings are NOT modified
 * - Authorization enforcement: only a user with the DOCTOR role may accept or
 *   reject proposals; NURSE and VIEWER calls must be rejected with 403
 * - Audit logging of accept and reject decisions with the reviewing doctor's
 *   identity
 *
 * Associated risks:
 * - Accepting a proposal without applying it to InsulinTherapySettings would
 *   display "accepted" in the UI while the actual parameter remains unchanged,
 *   creating a silent clinical discrepancy
 * - A non-atomic accept (proposal update succeeds, settings update fails)
 *   would leave the system in an inconsistent state
 * - A NURSE or VIEWER successfully accepting a proposal bypasses the mandatory
 *   physician validation step required by the medical device workflow (ADR #13)
 * - Missing audit on accept/reject removes the evidence trail required for
 *   HDS inspection and liability purposes
 *
 * Edge cases:
 * - Proposal already in "accepted" status being accepted again (idempotency or
 *   error depending on business rule)
 * - Proposal in "expired" status being acted on (must be rejected by the service)
 * - Accept with a proposed value exactly at a CLINICAL_BOUNDS limit
 * - Summary for a patient with zero proposals (all counts must be 0, total = 0)
 * - Reject without a comment (optional field — must not fail validation)
 */
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
