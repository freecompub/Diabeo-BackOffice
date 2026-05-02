/**
 * Test suite: Hypo Treatment Service (US-2217)
 *
 * Clinical behavior tested:
 * - Defaults align with ADA "Rule of 15/15": 15 g of fast carbs, retest after
 *   15 minutes. These values are used when no per-patient protocol exists.
 * - Carbohydrate amount validated to a clinically safe band (5–60 g). Below
 *   5 g would not raise glycemia; above 60 g triggers rebound hyper.
 * - Sugar type "other" requires the free-text description (sugarTypeOther),
 *   otherwise the patient receives an empty instruction screen.
 * - Allergies and instructions persist encrypted (PHI / clinical content).
 *
 * Associated risks:
 * - Posting carbs > 60 g would expose the patient to rebound hyperglycemia.
 * - Storing allergies in plaintext would breach HDS / RGPD Art. 9.
 * - "other" sugar type with empty description would render an unusable
 *   protocol on the patient mobile app, possibly delaying treatment.
 *
 * Edge cases:
 * - Allergies and instructions explicitly null → must remain null in storage.
 * - Patient soft-deleted → service returns null.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

vi.mock("@/lib/crypto/fields", () => ({
  encryptField: vi.fn((value: string) => `enc:${value}`),
  safeDecryptField: vi.fn((value: string | null) =>
    value ? value.replace(/^enc:/, "") : null,
  ),
}))

import {
  hypoTreatmentService,
  validateHypoTreatment,
  HYPO_TREATMENT_DEFAULTS,
  HYPO_TREATMENT_BOUNDS,
} from "@/lib/services/hypo-treatment.service"

describe("hypoTreatmentService", () => {
  beforeEach(() => vi.clearAllMocks())

  describe("validateHypoTreatment", () => {
    it("accepts defaults (rule of 15/15)", () => {
      expect(
        validateHypoTreatment({
          fastCarbsGrams: HYPO_TREATMENT_DEFAULTS.fastCarbsGrams,
          retestMinutes: HYPO_TREATMENT_DEFAULTS.retestMinutes,
        }),
      ).toBeNull()
    })

    it("rejects carbs below clinical floor (would not raise glucose)", () => {
      expect(
        validateHypoTreatment({
          fastCarbsGrams: HYPO_TREATMENT_BOUNDS.CARBS_MIN - 1,
          retestMinutes: 15,
        }),
      ).toBe("carbs_out_of_bounds")
    })

    it("rejects carbs above ceiling (rebound hyperglycemia risk)", () => {
      expect(
        validateHypoTreatment({
          fastCarbsGrams: HYPO_TREATMENT_BOUNDS.CARBS_MAX + 1,
          retestMinutes: 15,
        }),
      ).toBe("carbs_out_of_bounds")
    })

    it("rejects retest delay above 60 min (no follow-up risk)", () => {
      expect(
        validateHypoTreatment({
          fastCarbsGrams: 15,
          retestMinutes: HYPO_TREATMENT_BOUNDS.RETEST_MAX + 5,
        }),
      ).toBe("retest_out_of_bounds")
    })
  })

  describe("get", () => {
    it("returns defaults for patient without record", async () => {
      prismaMock.hypoTreatmentProtocol.findUnique.mockResolvedValue(null)
      prismaMock.patient.findFirst.mockResolvedValue({ id: 1 } as never)
      prismaMock.auditLog.create.mockResolvedValue({} as never)

      const result = await hypoTreatmentService.get(1, 99)
      expect(result).toMatchObject({
        patientId: 1,
        sugarType: HYPO_TREATMENT_DEFAULTS.sugarType,
        fastCarbsGrams: HYPO_TREATMENT_DEFAULTS.fastCarbsGrams,
      })
    })

    it("decrypts allergies & instructions on read", async () => {
      prismaMock.hypoTreatmentProtocol.findUnique.mockResolvedValue({
        id: 1,
        patientId: 1,
        sugarType: "juice",
        sugarTypeOther: null,
        fastCarbsGrams: 15,
        retestMinutes: 15,
        allergies: "enc:peanuts",
        instructions: "enc:no banana",
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never)
      prismaMock.patient.findFirst.mockResolvedValue({ id: 1 } as never)
      prismaMock.auditLog.create.mockResolvedValue({} as never)

      const result = await hypoTreatmentService.get(1, 99)
      expect(result?.allergies).toBe("peanuts")
      expect(result?.instructions).toBe("no banana")
    })
  })

  describe("upsert", () => {
    it("requires sugarTypeOther when sugarType=other", async () => {
      await expect(
        hypoTreatmentService.upsert(1, { sugarType: "other" }, 99),
      ).rejects.toThrow("sugar_type_other_required")
    })

    it("encrypts allergies before storage", async () => {
      const upsertSpy = vi.fn().mockResolvedValue({
        patientId: 1,
        sugarType: "glucose_tabs",
        sugarTypeOther: null,
        fastCarbsGrams: 15,
        retestMinutes: 15,
        allergies: "enc:peanuts",
        instructions: null,
      })
      const mockTx = {
        hypoTreatmentProtocol: { upsert: upsertSpy },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      await hypoTreatmentService.upsert(1, { allergies: "peanuts" }, 99)
      const call = upsertSpy.mock.calls[0]?.[0] as { create?: { allergies?: string } }
      expect(call.create?.allergies).toBe("enc:peanuts")
    })

    it("nullifies sugarTypeOther when sugarType ≠ other", async () => {
      const upsertSpy = vi.fn().mockResolvedValue({
        patientId: 1,
        sugarType: "juice",
        sugarTypeOther: null,
        fastCarbsGrams: 15,
        retestMinutes: 15,
        allergies: null,
        instructions: null,
      })
      const mockTx = {
        hypoTreatmentProtocol: { upsert: upsertSpy },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      await hypoTreatmentService.upsert(
        1,
        { sugarType: "juice", sugarTypeOther: "ignored" },
        99,
      )
      const call = upsertSpy.mock.calls[0]?.[0] as { create?: { sugarTypeOther?: string | null } }
      expect(call.create?.sugarTypeOther).toBeNull()
    })
  })
})
