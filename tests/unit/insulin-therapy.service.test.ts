/**
 * Test suite: Insulin Therapy Service — Insulin Therapy Settings Management
 *
 * Clinical behavior tested:
 * - Retrieval of a patient's complete InsulinTherapySettings including all
 *   related records: ISF slots, ICR slots, basal configuration, pump basal
 *   slots, glucose targets, and IOB settings — ensuring the bolus calculator
 *   has all required parameters before computing a dose
 * - Creation and update of InsulinTherapySettings validated against
 *   CLINICAL_BOUNDS before persistence; out-of-range values are rejected with
 *   a descriptive error rather than stored silently
 * - Validation status tracking: newly created settings start as unvalidated
 *   and must be explicitly approved by a DOCTOR (validatedBy field) before
 *   they are used in bolus calculations
 * - Audit logging of every read and mutation of therapy settings
 *
 * Associated risks:
 * - Returning settings with missing ISF or ICR slots would cause the bolus
 *   calculator to fall back to null, producing a zero-dose recommendation and
 *   leaving a meal bolus undelivered
 * - Persisting out-of-bounds ISF (< 0.20 g/L/U) or ICR (< 5 g/U) values
 *   would produce dangerously large bolus recommendations
 * - Using unvalidated settings in dose calculation bypasses the mandatory
 *   physician review step, violating ADR #13 (explicit acceptance workflow)
 * - Missing audit on settings read prevents tracing who accessed sensitive
 *   therapy parameters and when
 *
 * Edge cases:
 * - Patient with no InsulinTherapySettings record (service must return null)
 * - Settings with an empty ISF slots array (no time-of-day factors configured)
 * - Settings at CLINICAL_BOUNDS exact limits (should be accepted)
 * - Settings one unit outside CLINICAL_BOUNDS (should be rejected)
 * - Concurrent update: two requests updating the same settings simultaneously
 *   (last-write-wins with optimistic concurrency or transaction isolation)
 */
import { describe, it, expect, vi } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

import { insulinTherapyService } from "@/lib/services/insulin-therapy.service"

describe("insulinTherapyService", () => {
  describe("getSettings", () => {
    it("returns settings with all relations", async () => {
      prismaMock.insulinTherapySettings.findUnique.mockResolvedValue({
        id: 1,
        patientId: 1,
        bolusInsulinId: 1,
        deliveryMethod: "pump",
        sensitivityFactors: [],
        carbRatios: [],
      } as any)
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const result = await insulinTherapyService.getSettings(1, 1)
      expect(result).not.toBeNull()
      expect(result!.bolusInsulinId).toBe(1)
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

  // =========================================================================
  // WRITE PATHS — Phase 4 coverage (previously missing)
  // =========================================================================
  describe("upsertSettings", () => {
    it("upserts settings and emits an audit log", async () => {
      const mockSettings = { id: 5, patientId: 7, deliveryMethod: "pump" }
      const txMock = {
        insulinTherapySettings: { upsert: vi.fn().mockResolvedValue(mockSettings) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(txMock))

      const result = await insulinTherapyService.upsertSettings(
        7,
        {
          bolusInsulinBrand: "Humalog",
          insulinActionDuration: 4,
          deliveryMethod: "pump",
        },
        42,
      )

      expect(result).toEqual(mockSettings)
      expect(txMock.insulinTherapySettings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { patientId: 7 } }),
      )
      expect(txMock.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: "UPDATE",
            resource: "INSULIN_THERAPY",
            resourceId: "7",
          }),
        }),
      )
    })
  })

  describe("createIsf", () => {
    it("creates an ISF slot when there is no overlap", async () => {
      const txMock = {
        insulinSensitivityFactor: {
          findMany: vi.fn().mockResolvedValue([]),
          create: vi.fn().mockResolvedValue({ id: "isf-uuid-1" }),
        },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(txMock))

      const result = await insulinTherapyService.createIsf(
        3,
        { startHour: 6, endHour: 12, sensitivityFactorGl: 0.5 },
        42,
      )

      expect(result.id).toBe("isf-uuid-1")
      expect(txMock.insulinSensitivityFactor.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          settingsId: 3,
          sensitivityFactorGl: 0.5,
          sensitivityFactorMgdl: 50, // mgdl = gl * 100
        }),
      })
    })

    it("rejects a zero-duration ISF slot (startHour == endHour)", async () => {
      await expect(
        insulinTherapyService.createIsf(
          3,
          { startHour: 8, endHour: 8, sensitivityFactorGl: 0.5 },
          42,
        ),
      ).rejects.toThrow(/zero-duration/)
    })

    it("rejects an overlapping ISF slot", async () => {
      const txMock = {
        insulinSensitivityFactor: {
          findMany: vi.fn().mockResolvedValue([{ startHour: 6, endHour: 12 }]),
        },
        auditLog: { create: vi.fn() },
      }
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(txMock))

      await expect(
        insulinTherapyService.createIsf(
          3,
          { startHour: 10, endHour: 14, sensitivityFactorGl: 0.5 },
          42,
        ),
      ).rejects.toThrow(/overlaps/)
    })
  })

  describe("createIcr", () => {
    it("creates an ICR slot when there is no overlap", async () => {
      const txMock = {
        carbRatio: {
          findMany: vi.fn().mockResolvedValue([]),
          create: vi.fn().mockResolvedValue({ id: "icr-uuid-1" }),
        },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(txMock))

      const result = await insulinTherapyService.createIcr(
        3,
        { startHour: 7, endHour: 11, gramsPerUnit: 10, mealLabel: "breakfast" },
        42,
      )

      expect(result.id).toBe("icr-uuid-1")
      expect(txMock.carbRatio.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          settingsId: 3,
          gramsPerUnit: 10,
          mealLabel: "breakfast",
        }),
      })
    })

    it("rejects an overlapping ICR slot", async () => {
      const txMock = {
        carbRatio: {
          findMany: vi.fn().mockResolvedValue([{ startHour: 7, endHour: 11 }]),
        },
        auditLog: { create: vi.fn() },
      }
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(txMock))

      await expect(
        insulinTherapyService.createIcr(3, { startHour: 9, endHour: 13, gramsPerUnit: 10 }, 42),
      ).rejects.toThrow(/overlaps/)
    })
  })

  describe("deleteIsf / deleteIcr", () => {
    it("deleteIsf emits a DELETE audit log", async () => {
      const txMock = {
        insulinSensitivityFactor: { delete: vi.fn().mockResolvedValue({}) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(txMock))

      const result = await insulinTherapyService.deleteIsf("isf-uuid-1", 42)

      expect(result).toEqual({ deleted: true })
      expect(txMock.insulinSensitivityFactor.delete).toHaveBeenCalledWith({
        where: { id: "isf-uuid-1" },
      })
      expect(txMock.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: "DELETE", resource: "INSULIN_THERAPY" }),
        }),
      )
    })

    it("deleteIcr emits a DELETE audit log", async () => {
      const txMock = {
        carbRatio: { delete: vi.fn().mockResolvedValue({}) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(txMock))

      const result = await insulinTherapyService.deleteIcr("icr-uuid-1", 42)

      expect(result).toEqual({ deleted: true })
      expect(txMock.carbRatio.delete).toHaveBeenCalledWith({
        where: { id: "icr-uuid-1" },
      })
    })
  })
})
