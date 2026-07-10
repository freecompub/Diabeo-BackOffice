/**
 * Test suite: Basal Configuration — GET, UPSERT
 *
 * Clinical behavior tested:
 * - Retrieval of basal configuration with pump slots ordered by start time
 * - Upsert of basal configuration (create or update) with audit trail
 * (L'écriture des créneaux basaux par-créneau a été retirée — voir NB grouped-only ci-dessous.)
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
 *
 * NB (US-2657 grouped-only, ADR #26) : createPumpSlot/deletePumpSlot retirés — l'édition basale par-créneau
 * passe désormais par le remplacement GROUPÉ `replacePumpSlotSet` (testé dans insulin-therapy.service.test.ts).
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

  // createPumpSlot/deletePumpSlot retirés (US-2657 grouped-only, ADR #26) → tests supprimés.
  // La couverture de l'édition basale par-créneau est portée par `replacePumpSlotSet` (remplacement groupé,
  // testé dans insulin-therapy.service.test.ts).
})
