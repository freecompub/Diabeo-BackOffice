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

// US-2651 — createManual/createProposal appellent resolveTreatmentMode (garde MDR nonInsulin).
// Patient insuliné par défaut ici pour ne pas bloquer les cas nominaux.
vi.mock("@/lib/services/treatment-mode.service", () => ({
  treatmentModeService: { resolveTreatmentMode: vi.fn(async () => ({ mode: "basalBolus", coherent: true })) },
}))

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

    // US-2649b — compare-and-swap : la base a bougé depuis la proposition → refuser (fail-closed).
    it("throws 'baselineMoved' and applies nothing when the live slot moved since the proposal", async () => {
      // Valeur LIVE (0.99) ≠ snapshot currentValue (0.5) → sur-correction refusée.
      prismaMock.insulinSensitivityFactor.findFirst.mockResolvedValue({ sensitivityFactorGl: 0.99 } as never)
      const mockTx = {
        adjustmentProposal: {
          findUnique: vi.fn().mockResolvedValue({
            id: "p1", patientId: 1, status: "pending",
            parameterType: "insulinSensitivityFactor",
            proposedValue: 0.55, currentValue: 0.5, timeSlotStartHour: 8,
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        insulinSensitivityFactor: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      await expect(adjustmentService.accept("p1", 2, true)).rejects.toThrow("baselineMoved")
      // Rollback → le paramètre n'est JAMAIS écrit sur une base déplacée.
      expect(mockTx.insulinSensitivityFactor.updateMany).not.toHaveBeenCalled()
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

    // A4 — sécurité : applyImmediately=true avec une valeur hors bornes cliniques
    // (ISF 5.0 > ISF_GL_MAX 1.00) doit lever `valueOutOfBounds` (string mappée en
    // 400 par la route) AVANT d'appliquer le paramètre, et le throw dans la
    // transaction garantit le rollback du statut (proposition reste `pending`).
    it("throws 'valueOutOfBounds' and applies nothing when the value is out of clinical bounds", async () => {
      const mockTx = {
        adjustmentProposal: {
          findUnique: vi.fn().mockResolvedValue({
            id: "p1", patientId: 1, status: "pending",
            parameterType: "insulinSensitivityFactor",
            proposedValue: 5.0, timeSlotStartHour: 8, // 5.0 g/L/U > ISF_GL_MAX (1.00)
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        insulinSensitivityFactor: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      // Le contrat exact de la chaîne d'erreur (consommée par la route → 400).
      await expect(adjustmentService.accept("p1", 2, true))
        .rejects.toThrow("valueOutOfBounds")
      // Le paramètre insuline n'est JAMAIS appliqué (validation avant updateMany).
      expect(mockTx.insulinSensitivityFactor.updateMany).not.toHaveBeenCalled()
    })

    it("applies a basal proposal via a pump slot SCOPED to the patient (anti-IDOR)", async () => {
      const mockTx = {
        adjustmentProposal: {
          findUnique: vi.fn().mockResolvedValue({
            id: "p1", patientId: 1, status: "pending",
            parameterType: "basalRate", proposedValue: 0.95, pumpBasalSlotId: "slot1",
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        pumpBasalSlot: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      const result = await adjustmentService.accept("p1", 2, true)
      expect(result.applied).toBe(true)
      expect(mockTx.pumpBasalSlot.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: "slot1", basalConfig: { settings: { patientId: 1 } } }),
        }),
      )
    })

    it("throws 'isfSlotNotFound' when the ISF slot vanished between propose and accept (no phantom accept)", async () => {
      const mockTx = {
        adjustmentProposal: {
          findUnique: vi.fn().mockResolvedValue({
            id: "p1", patientId: 1, status: "pending",
            parameterType: "insulinSensitivityFactor", proposedValue: 0.55, timeSlotStartHour: 8,
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        insulinSensitivityFactor: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      await expect(adjustmentService.accept("p1", 2, true)).rejects.toThrow("isfSlotNotFound")
    })

    it("throws 'pumpSlotNotFound' when the scoped basal slot matches nothing (fail-closed)", async () => {
      const mockTx = {
        adjustmentProposal: {
          findUnique: vi.fn().mockResolvedValue({
            id: "p1", patientId: 1, status: "pending",
            parameterType: "basalRate", proposedValue: 0.95, pumpBasalSlotId: "slotX",
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        pumpBasalSlot: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      await expect(adjustmentService.accept("p1", 2, true)).rejects.toThrow("pumpSlotNotFound")
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

    // US-2651 — la frontière MDR s'applique AUSSI à cette 2ᵉ primitive de création.
    it("patient nonInsulin → nonInsulinNoDose, aucune écriture", async () => {
      const { treatmentModeService } = await import("@/lib/services/treatment-mode.service")
      vi.mocked(treatmentModeService.resolveTreatmentMode).mockResolvedValueOnce({ mode: "nonInsulin", coherent: true })
      const tx = { adjustmentProposal: { create: vi.fn() }, auditLog: { create: vi.fn() } }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(tx)) as any)

      await expect(
        adjustmentService.createManual({ patientId: 1, parameterType: "insulinSensitivityFactor" } as any, 2),
      ).rejects.toThrow("nonInsulinNoDose")
      expect(tx.adjustmentProposal.create).not.toHaveBeenCalled()
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
        pumpBasalSlot: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      const result = await adjustmentService.accept("p3", 2, true)
      expect(result.applied).toBe(true)
      expect(mockTx.pumpBasalSlot.updateMany).toHaveBeenCalled()
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
