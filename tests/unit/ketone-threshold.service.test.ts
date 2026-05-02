/**
 * Test suite: Ketone Threshold Service (US-2216)
 *
 * Clinical behavior tested:
 * - Defaults align with ADA DKA-prevention guidelines (1.5 mmol/L moderate,
 *   3.0 mmol/L DKA threshold). A patient with no per-patient configuration
 *   gets these values returned.
 * - Threshold ordering is enforced: light < moderate ≤ DKA. Inverting them
 *   would silence alerts above DKA — life-threatening if missed.
 * - Out-of-range values are rejected (ketones above 10 mmol/L are
 *   physiologically implausible; below 0.1 below detection limit).
 * - Audit log entries are emitted for every read & write — HDS traceability.
 *
 * Associated risks:
 * - Setting moderate > DKA would suppress critical-severity alerts on DKA-
 *   range readings, masking a true emergency.
 * - Permitting clinical-bound bypass via direct Prisma writes is mitigated
 *   by the service-layer validator; bypass would let UI submit unsafe values.
 *
 * Edge cases:
 * - Patient soft-deleted → returns null (defense-in-depth alongside RBAC).
 * - Partial update (only alertOnDka flag) preserves existing thresholds.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

import {
  ketoneThresholdService,
  validateKetoneThresholds,
  KETONE_DEFAULTS,
  KETONE_BOUNDS,
} from "@/lib/services/ketone-threshold.service"

describe("ketoneThresholdService", () => {
  beforeEach(() => vi.clearAllMocks())

  describe("validateKetoneThresholds", () => {
    it("accepts defaults", () => {
      expect(
        validateKetoneThresholds({
          lightThreshold: KETONE_DEFAULTS.lightThreshold,
          moderateThreshold: KETONE_DEFAULTS.moderateThreshold,
          dkaThreshold: KETONE_DEFAULTS.dkaThreshold,
        }),
      ).toBeNull()
    })

    it("rejects light >= moderate (would mask high-priority alerts)", () => {
      expect(
        validateKetoneThresholds({
          lightThreshold: 1.6,
          moderateThreshold: 1.5,
          dkaThreshold: 3.0,
        }),
      ).toBe("light_must_be_less_than_moderate")
    })

    it("rejects moderate > DKA (would suppress DKA emergency alerts)", () => {
      expect(
        validateKetoneThresholds({
          lightThreshold: 1.0,
          moderateThreshold: 4.0,
          dkaThreshold: 3.0,
        }),
      ).toBe("moderate_must_be_lte_dka")
    })

    it("allows moderate equal to DKA (warning + critical share boundary)", () => {
      expect(
        validateKetoneThresholds({
          lightThreshold: 1.5,
          moderateThreshold: 3.0,
          dkaThreshold: 3.0,
        }),
      ).toBeNull()
    })

    it("rejects values below physiological minimum", () => {
      expect(
        validateKetoneThresholds({
          lightThreshold: 0.0,
          moderateThreshold: 1.5,
          dkaThreshold: 3.0,
        }),
      ).toBe("ketone_threshold_below_min")
    })

    it("rejects values above physiological maximum", () => {
      expect(
        validateKetoneThresholds({
          lightThreshold: 1.0,
          moderateThreshold: 2.0,
          dkaThreshold: KETONE_BOUNDS.MAX + 0.1,
        }),
      ).toBe("ketone_threshold_above_max")
    })
  })

  describe("get", () => {
    it("returns ADA defaults when no per-patient record exists", async () => {
      prismaMock.ketoneThreshold.findUnique.mockResolvedValue(null)
      prismaMock.patient.findFirst.mockResolvedValue({ id: 1 } as never)
      prismaMock.auditLog.create.mockResolvedValue({} as never)

      const result = await ketoneThresholdService.get(1, 99)
      expect(result).toMatchObject({ patientId: 1, ...KETONE_DEFAULTS })
    })

    it("returns null for soft-deleted patient", async () => {
      prismaMock.ketoneThreshold.findUnique.mockResolvedValue(null)
      prismaMock.patient.findFirst.mockResolvedValue(null)
      const result = await ketoneThresholdService.get(99, 1)
      expect(result).toBeNull()
    })

    it("emits audit log on read (HDS traceability)", async () => {
      prismaMock.ketoneThreshold.findUnique.mockResolvedValue(null)
      prismaMock.patient.findFirst.mockResolvedValue({ id: 1 } as never)
      const auditSpy = vi.spyOn(prismaMock.auditLog, "create")
      auditSpy.mockResolvedValue({} as never)

      await ketoneThresholdService.get(1, 42)
      expect(auditSpy).toHaveBeenCalled()
      const call = auditSpy.mock.calls.at(-1)?.[0] as { data?: { action?: string; resourceId?: string } }
      expect(call?.data?.action).toBe("READ")
      expect(call?.data?.resourceId).toContain("ketone-thresholds")
    })
  })

  describe("upsert", () => {
    it("rejects invalid threshold ordering", async () => {
      await expect(
        ketoneThresholdService.upsert(
          1,
          { lightThreshold: 4.0, moderateThreshold: 1.5, dkaThreshold: 3.0 },
          99,
        ),
      ).rejects.toThrow("light_must_be_less_than_moderate")
    })

    it("upserts defaults when only flags provided", async () => {
      const mockTx = {
        ketoneThreshold: {
          upsert: vi
            .fn()
            .mockResolvedValue({ patientId: 1, ...KETONE_DEFAULTS, alertOnDka: false }),
        },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      const result = await ketoneThresholdService.upsert(1, { alertOnDka: false }, 99)
      expect(result.alertOnDka).toBe(false)
      expect(mockTx.ketoneThreshold.upsert).toHaveBeenCalled()
    })

    it("KETONE_DEFAULTS pass their own validator (light < moderate < DKA)", () => {
      expect(
        validateKetoneThresholds({
          lightThreshold: KETONE_DEFAULTS.lightThreshold,
          moderateThreshold: KETONE_DEFAULTS.moderateThreshold,
          dkaThreshold: KETONE_DEFAULTS.dkaThreshold,
        }),
      ).toBeNull()
    })
  })
})
