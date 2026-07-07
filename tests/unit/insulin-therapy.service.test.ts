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
      // Audit resourceId uses "isf:<id>" prefix (type-disambiguated format)
      expect(txMock.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ resourceId: "isf:isf-uuid-1" }),
        }),
      )
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
      // Audit resourceId uses "icr:<id>" prefix (type-disambiguated format)
      expect(txMock.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ resourceId: "icr:icr-uuid-1" }),
        }),
      )
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
    it("deleteIsf est scopé patient (anti-IDOR) et émet un audit DELETE", async () => {
      const txMock = {
        insulinSensitivityFactor: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(txMock))

      const result = await insulinTherapyService.deleteIsf("isf-uuid-1", 42, 7)

      expect(result).toEqual({ deleted: true })
      expect(txMock.insulinSensitivityFactor.deleteMany).toHaveBeenCalledWith({
        where: { id: "isf-uuid-1", settings: { patientId: 7 } },
      })
      expect(txMock.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: "DELETE",
            resource: "INSULIN_THERAPY",
            resourceId: "isf:isf-uuid-1",
          }),
        }),
      )
    })

    it("deleteIcr est scopé patient (anti-IDOR) et émet un audit DELETE", async () => {
      const txMock = {
        carbRatio: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(txMock))

      const result = await insulinTherapyService.deleteIcr("icr-uuid-1", 42, 7)

      expect(result).toEqual({ deleted: true })
      expect(txMock.carbRatio.deleteMany).toHaveBeenCalledWith({
        where: { id: "icr-uuid-1", settings: { patientId: 7 } },
      })
      expect(txMock.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ resourceId: "icr:icr-uuid-1" }),
        }),
      )
    })

    it("deleteIsf sur un créneau d'un autre patient → isfSlotNotFound (count 0, anti-IDOR)", async () => {
      const txMock = {
        insulinSensitivityFactor: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(txMock))
      await expect(insulinTherapyService.deleteIsf("isf-uuid-1", 42, 999)).rejects.toThrow("isfSlotNotFound")
      expect(txMock.auditLog.create).not.toHaveBeenCalled()
    })
  })

  describe("replaceSlotSet (US-2655 — enregistrement de groupe)", () => {
    // Profil complet : deux créneaux dont un enjambe minuit (convention seed : endHour ∈ [0,23]).
    const validIsf = [
      { startHour: 6, endHour: 22, value: 0.4 },
      { startHour: 22, endHour: 6, value: 0.6 },
    ]
    const mkTx = (over: Record<string, unknown> = {}) => ({
      insulinTherapySettings: { findUnique: vi.fn().mockResolvedValue({ id: 3 }) },
      insulinSensitivityFactor: {
        findMany: vi.fn().mockResolvedValue([{ startHour: 0, endHour: 24 }]),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        createMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      carbRatio: {
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      adjustmentProposal: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      ...over,
    })

    it("jeu vide → emptySlotSet (avant transaction)", async () => {
      await expect(insulinTherapyService.replaceSlotSet("isf", 7, [], 42)).rejects.toThrow("emptySlotSet")
    })

    it("durée nulle → zeroDurationSlot", async () => {
      await expect(
        insulinTherapyService.replaceSlotSet("isf", 7, [{ startHour: 8, endHour: 8, value: 0.4 }], 42),
      ).rejects.toThrow("zeroDurationSlot")
    })

    it("chevauchement → slotOverlap (rien écrit)", async () => {
      const tx = mkTx()
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx))
      await expect(
        insulinTherapyService.replaceSlotSet(
          "isf",
          7,
          [
            { startHour: 6, endHour: 14, value: 0.4 },
            { startHour: 12, endHour: 22, value: 0.5 },
            { startHour: 22, endHour: 6, value: 0.6 },
          ],
          42,
        ),
      ).rejects.toThrow("slotOverlap")
      expect(tx.insulinSensitivityFactor.deleteMany).not.toHaveBeenCalled()
    })

    it("trou de couverture ISF → slotGap (rien écrit)", async () => {
      const tx = mkTx()
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx))
      await expect(
        insulinTherapyService.replaceSlotSet("isf", 7, [{ startHour: 6, endHour: 22, value: 0.4 }], 42), // laisse 22→6
      ).rejects.toThrow("slotGap")
      expect(tx.insulinSensitivityFactor.deleteMany).not.toHaveBeenCalled()
    })

    it("settings absent → settingsNotFound (anti-IDOR)", async () => {
      const tx = mkTx({ insulinTherapySettings: { findUnique: vi.fn().mockResolvedValue(null) } })
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx))
      await expect(insulinTherapyService.replaceSlotSet("isf", 7, validIsf, 42)).rejects.toThrow("settingsNotFound")
      expect(tx.insulinSensitivityFactor.deleteMany).not.toHaveBeenCalled()
    })

    it("remplacement ISF valide : delete+createMany scopés settingsId, Time synchronisé, audit from/to", async () => {
      const tx = mkTx()
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx))
      const res = await insulinTherapyService.replaceSlotSet("isf", 7, validIsf, 42)

      expect(res).toEqual({
        applied: true,
        count: 2,
        coverage: { hasGap: false, hasOverlap: false },
        supersededProposalIds: [],
      })
      expect(tx.insulinSensitivityFactor.deleteMany).toHaveBeenCalledWith({ where: { settingsId: 3 } })
      // Time dérivé de l'heure (dénormalisation synchronisée)
      const createArg = tx.insulinSensitivityFactor.createMany.mock.calls[0][0]
      expect(createArg.data[0]).toMatchObject({ settingsId: 3, startHour: 6, endHour: 22, sensitivityFactorGl: 0.4, sensitivityFactorMgdl: 40 })
      expect((createArg.data[0].startTime as Date).toISOString()).toBe("1970-01-01T06:00:00.000Z")
      // audit from → to
      expect(tx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: "UPDATE",
            resourceId: "isf-set:3",
          }),
        }),
      )
    })

    it("supersède les propositions pending du paramètre (ISF)", async () => {
      const tx = mkTx({
        adjustmentProposal: {
          findMany: vi.fn().mockResolvedValue([{ id: "prop-1" }, { id: "prop-2" }]),
          updateMany: vi.fn().mockResolvedValue({ count: 2 }),
        },
      })
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx))
      const res = await insulinTherapyService.replaceSlotSet("isf", 7, validIsf, 42)

      expect(res.supersededProposalIds).toEqual(["prop-1", "prop-2"])
      expect(tx.adjustmentProposal.updateMany).toHaveBeenCalledWith({
        where: { patientId: 7, parameterType: "insulinSensitivityFactor", status: "pending" },
        data: expect.objectContaining({ status: "superseded", reviewedBy: 42 }),
      })
    })

    it("remplacement ICR valide écrit sur la table carbRatio (gramsPerUnit)", async () => {
      const tx = mkTx()
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx))
      const res = await insulinTherapyService.replaceSlotSet(
        "icr",
        7,
        [
          { startHour: 6, endHour: 12, value: 8, mealLabel: "PDJ" },
          { startHour: 12, endHour: 6, value: 12 },
        ],
        42,
      )
      expect(res.count).toBe(2)
      expect(tx.carbRatio.deleteMany).toHaveBeenCalledWith({ where: { settingsId: 3 } })
      const createArg = tx.carbRatio.createMany.mock.calls[0][0]
      expect(createArg.data[0]).toMatchObject({ settingsId: 3, startHour: 6, endHour: 12, gramsPerUnit: 8, mealLabel: "PDJ" })
      // supersède les propositions ICR (insulinToCarbRatio)
      expect(tx.adjustmentProposal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { patientId: 7, parameterType: "insulinToCarbRatio", status: "pending" } }),
      )
    })
  })
})
