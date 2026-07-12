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

import { insulinTherapyService, assertValidPumpSlotSet } from "@/lib/services/insulin-therapy.service"

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
        $queryRaw: vi.fn().mockResolvedValue([{ locked: true }]),
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

  // createIsf/deleteIsf/createIcr/deleteIcr retirés (US-2657 grouped-only, ADR #26) → tests supprimés.
  // La couverture de l'ajout/suppression par-créneau est portée par `replaceSlotSet` (remplacement groupé).

  describe("replaceSlotSet (US-2655 — enregistrement de groupe)", () => {
    // Profil complet : deux créneaux dont un enjambe minuit (convention seed : endHour ∈ [0,23]).
    const validIsf = [
      { startHour: 6, endHour: 22, value: 0.4 },
      { startHour: 22, endHour: 6, value: 0.6 },
    ]
    const mkTx = (over: Record<string, unknown> = {}) => ({
      $queryRaw: vi.fn().mockResolvedValue([{ locked: true }]),
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
      // US-2657 — finishReplaceSet supersède aussi les propositions d'ENSEMBLE pending.
      slotSetProposal: {
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

    it("valeur hors bornes cliniques → valueOutOfBounds (défense en profondeur service)", async () => {
      // ISF_GL_MAX = 1.00 → 1.5 hors bornes, même en appelant le service directement (sans la route Zod).
      await expect(
        insulinTherapyService.replaceSlotSet(
          "isf",
          7,
          [
            { startHour: 6, endHour: 22, value: 1.5 },
            { startHour: 22, endHour: 6, value: 0.6 },
          ],
          42,
        ),
      ).rejects.toThrow("valueOutOfBounds")
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
        supersededSetProposalIds: [],
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

    // ── US-2663 (S1) — CAS d'ensemble fail-closed (expectedBaseline) ──────────────────────────
    it("CAS : base LIVE identique au snapshot → applique (delete+createMany)", async () => {
      const tx = mkTx({
        insulinSensitivityFactor: {
          findMany: vi.fn().mockResolvedValue([
            { startHour: 6, endHour: 22, sensitivityFactorGl: 0.4 },
            { startHour: 22, endHour: 6, sensitivityFactorGl: 0.6 },
          ]),
          deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
          createMany: vi.fn().mockResolvedValue({ count: 2 }),
        },
      })
      // expectedBaseline (7e arg) = base attendue, identique au live → CAS OK.
      const res = await insulinTherapyService.replaceSlotSet("isf", 7, validIsf, 42, undefined, tx as never, validIsf)
      expect(res.applied).toBe(true)
      expect(tx.insulinSensitivityFactor.deleteMany).toHaveBeenCalled()
      expect(tx.insulinSensitivityFactor.createMany).toHaveBeenCalled()
    })

    it("CAS : base LIVE a DÉRIVÉ (valeur différente) → baselineMoved, RIEN écrit (fail-closed)", async () => {
      const tx = mkTx({
        insulinSensitivityFactor: {
          findMany: vi.fn().mockResolvedValue([
            { startHour: 6, endHour: 22, sensitivityFactorGl: 0.5 }, // 0.5 ≠ 0.4 attendu (ajustement médecin concurrent)
            { startHour: 22, endHour: 6, sensitivityFactorGl: 0.6 },
          ]),
          deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
          createMany: vi.fn().mockResolvedValue({ count: 2 }),
        },
      })
      await expect(
        insulinTherapyService.replaceSlotSet("isf", 7, validIsf, 42, undefined, tx as never, validIsf),
      ).rejects.toThrow("baselineMoved")
      expect(tx.insulinSensitivityFactor.deleteMany).not.toHaveBeenCalled()
      expect(tx.insulinSensitivityFactor.createMany).not.toHaveBeenCalled()
    })

    it("CAS : snapshot ABSENT (legacy `null`) → baselineMissing, RIEN écrit (fail-closed)", async () => {
      const tx = mkTx()
      await expect(
        insulinTherapyService.replaceSlotSet("isf", 7, validIsf, 42, undefined, tx as never, null),
      ).rejects.toThrow("baselineMissing")
      expect(tx.insulinSensitivityFactor.deleteMany).not.toHaveBeenCalled()
    })

    it("chemin DOCTOR direct (expectedBaseline absent) → PAS de CAS, applique normalement", async () => {
      const tx = mkTx()
      const res = await insulinTherapyService.replaceSlotSet("isf", 7, validIsf, 42, undefined, tx as never)
      expect(res.applied).toBe(true)
      expect(tx.insulinSensitivityFactor.deleteMany).toHaveBeenCalled()
    })
  })

  // ── US-2657 (grouped-only) — validation + remplacement GROUPÉ du BASAL (pompe) ──────────────
  describe("assertValidPumpSlotSet (garde clinique basale — pure)", () => {
    // Profil complet 24 h (deux créneaux, l'un enjambe minuit) — no-gap/no-overlap.
    const validBasal = [
      { startTime: "06:00", endTime: "22:00", rate: 0.9 },
      { startTime: "22:00", endTime: "06:00", rate: 0.75 },
    ]
    it("jeu vide → emptySlotSet", () => {
      expect(() => assertValidPumpSlotSet([])).toThrow("emptySlotSet")
    })
    it("durée nulle → zeroDurationSlot", () => {
      expect(() => assertValidPumpSlotSet([{ startTime: "08:00", endTime: "08:00", rate: 0.9 }])).toThrow("zeroDurationSlot")
    })
    it("débit hors bornes cliniques → valueOutOfBounds", () => {
      // BASAL_MAX = 5.0 → 6 hors bornes.
      expect(() => assertValidPumpSlotSet([{ startTime: "00:00", endTime: "12:00", rate: 6 }, { startTime: "12:00", endTime: "00:00", rate: 0.9 }])).toThrow("valueOutOfBounds")
    })
    it("débit non délivrable (hors incrément pompe 0,05) → rateNotDeliverable", () => {
      expect(() => assertValidPumpSlotSet([{ startTime: "00:00", endTime: "12:00", rate: 0.37 }, { startTime: "12:00", endTime: "00:00", rate: 0.9 }])).toThrow("rateNotDeliverable")
    })
    it("chevauchement → slotOverlap (double délivrance basale)", () => {
      expect(() => assertValidPumpSlotSet([
        { startTime: "06:00", endTime: "14:00", rate: 0.9 },
        { startTime: "12:00", endTime: "22:00", rate: 0.8 },
        { startTime: "22:00", endTime: "06:00", rate: 0.75 },
      ])).toThrow("slotOverlap")
    })
    it("trou de couverture → slotGap (fenêtre sans basale)", () => {
      // laisse 22:00→06:00 non couvert.
      expect(() => assertValidPumpSlotSet([{ startTime: "06:00", endTime: "22:00", rate: 0.9 }])).toThrow("slotGap")
    })
    it("profil 24 h complet no-gap/no-overlap → OK", () => {
      expect(assertValidPumpSlotSet(validBasal)).toEqual({ hasGap: false, hasOverlap: false })
    })
  })

  describe("replacePumpSlotSet (US-2657 — remplacement groupé basal)", () => {
    const validBasal = [
      { startTime: "06:00", endTime: "22:00", rate: 0.9 },
      { startTime: "22:00", endTime: "06:00", rate: 0.75 },
    ]
    const mkTx = (over: Record<string, unknown> = {}) => ({
      $queryRaw: vi.fn().mockResolvedValue([{ locked: true }]),
      insulinTherapySettings: { findUnique: vi.fn().mockResolvedValue({ id: 3, basalConfiguration: { id: 9, configType: "pump" } }) },
      pumpBasalSlot: {
        findMany: vi.fn().mockResolvedValue([{ startTime: new Date("1970-01-01T00:00:00Z"), endTime: new Date("1970-01-01T00:00:00Z") }]),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
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
      await expect(insulinTherapyService.replacePumpSlotSet(7, [], 42)).rejects.toThrow("emptySlotSet")
    })

    it("verrou occupé → slotsBusy (rien écrit)", async () => {
      const tx = mkTx({ $queryRaw: vi.fn().mockResolvedValue([{ locked: false }]) })
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx))
      await expect(insulinTherapyService.replacePumpSlotSet(7, validBasal, 42)).rejects.toThrow("slotsBusy")
      expect(tx.pumpBasalSlot.deleteMany).not.toHaveBeenCalled()
    })

    it("settings absent → settingsNotFound (anti-IDOR, rien écrit)", async () => {
      const tx = mkTx({ insulinTherapySettings: { findUnique: vi.fn().mockResolvedValue(null) } })
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx))
      await expect(insulinTherapyService.replacePumpSlotSet(7, validBasal, 42)).rejects.toThrow("settingsNotFound")
      expect(tx.pumpBasalSlot.deleteMany).not.toHaveBeenCalled()
    })

    it("configuration basale absente → basalConfigNotFound (rien écrit)", async () => {
      const tx = mkTx({ insulinTherapySettings: { findUnique: vi.fn().mockResolvedValue({ id: 3, basalConfiguration: null }) } })
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx))
      await expect(insulinTherapyService.replacePumpSlotSet(7, validBasal, 42)).rejects.toThrow("basalConfigNotFound")
      expect(tx.pumpBasalSlot.deleteMany).not.toHaveBeenCalled()
    })

    it("patient NON pompe (MDI single_injection) → basalConfigNotPump (intégrité du mode, rien écrit)", async () => {
      const tx = mkTx({ insulinTherapySettings: { findUnique: vi.fn().mockResolvedValue({ id: 3, basalConfiguration: { id: 9, configType: "single_injection" } }) } })
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx))
      await expect(insulinTherapyService.replacePumpSlotSet(7, validBasal, 42)).rejects.toThrow("basalConfigNotPump")
      expect(tx.pumpBasalSlot.deleteMany).not.toHaveBeenCalled()
    })

    it("profil valide → REPLACE atomique (delete+create) scopé basalConfigId + supersède propositions basales", async () => {
      const tx = mkTx()
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx))
      const res = await insulinTherapyService.replacePumpSlotSet(7, validBasal, 42)
      expect(res).toMatchObject({ applied: true, count: 2 })
      expect(tx.pumpBasalSlot.deleteMany).toHaveBeenCalledWith({ where: { basalConfigId: 9 } })
      const createArg = tx.pumpBasalSlot.createMany.mock.calls[0][0]
      expect(createArg.data[0]).toMatchObject({ basalConfigId: 9, rate: 0.9 })
      // supersède les propositions basales pending (parameterType basalRate)
      expect(tx.adjustmentProposal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { patientId: 7, parameterType: "basalRate", status: "pending" } }),
      )
    })
  })
})
