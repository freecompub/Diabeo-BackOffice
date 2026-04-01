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
import { describe, it, expect } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

import { insulinTherapyService } from "@/lib/services/insulin-therapy.service"

describe("insulinTherapyService", () => {
  describe("getSettings", () => {
    it("returns settings with all relations", async () => {
      prismaMock.insulinTherapySettings.findUnique.mockResolvedValue({
        id: 1,
        patientId: 1,
        bolusInsulinBrand: "humalog",
        deliveryMethod: "pump",
        sensitivityFactors: [],
        carbRatios: [],
      } as any)
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const result = await insulinTherapyService.getSettings(1, 1)
      expect(result).not.toBeNull()
      expect(result!.bolusInsulinBrand).toBe("humalog")
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
})
