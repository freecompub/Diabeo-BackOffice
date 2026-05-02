/**
 * Test suite: Alert Threshold Service (US-2215)
 *
 * Clinical behavior tested:
 * - Defaults emit alerts on hypo / severe hypo / severe hyper but NOT on
 *   simple hyper, since chronically high values would generate alert fatigue
 *   and desensitize doctors.
 * - Cooldown bounds (5–1440 min) prevent two failure modes: < 5 min would
 *   spam doctors on noisy CGM data; > 24h would silence consecutive episodes
 *   on different days.
 * - Audit log entries are emitted on every read & write.
 *
 * Associated risks:
 * - Cooldown of 0 would flood notifications during oscillating glucose.
 * - Cooldown above 24h would lose visibility on next-day repeat events.
 * - Disabling notifyDoctorPush silently would prevent escalation reaching
 *   the referent — this should require an audit trail (covered by audit).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

import {
  alertThresholdService,
  ALERT_THRESHOLD_DEFAULTS,
  COOLDOWN_BOUNDS,
} from "@/lib/services/alert-threshold.service"

describe("alertThresholdService", () => {
  beforeEach(() => vi.clearAllMocks())

  describe("get", () => {
    it("returns defaults when no record exists (alert fatigue mitigation)", async () => {
      prismaMock.alertThresholdConfig.findUnique.mockResolvedValue(null)
      prismaMock.patient.findFirst.mockResolvedValue({ id: 1 } as never)
      prismaMock.auditLog.create.mockResolvedValue({} as never)

      const result = await alertThresholdService.get(1, 99)
      expect(result).toMatchObject({ patientId: 1, ...ALERT_THRESHOLD_DEFAULTS })
      // Defaults: simple hyper alerts off (alert-fatigue), severe hyper on.
      expect((result as { alertOnHyper: boolean }).alertOnHyper).toBe(false)
      expect((result as { alertOnSevereHyper: boolean }).alertOnSevereHyper).toBe(true)
    })

    it("returns null for soft-deleted patient (defense in depth)", async () => {
      prismaMock.alertThresholdConfig.findUnique.mockResolvedValue(null)
      prismaMock.patient.findFirst.mockResolvedValue(null)
      const result = await alertThresholdService.get(1, 99)
      expect(result).toBeNull()
    })
  })

  describe("upsert", () => {
    it("rejects cooldown below floor (notification flood risk)", async () => {
      await expect(
        alertThresholdService.upsert(1, { cooldownMinutes: COOLDOWN_BOUNDS.MIN - 1 }, 99),
      ).rejects.toThrow("cooldown_out_of_bounds")
    })

    it("rejects cooldown above ceiling (24h silence risk)", async () => {
      await expect(
        alertThresholdService.upsert(1, { cooldownMinutes: COOLDOWN_BOUNDS.MAX + 1 }, 99),
      ).rejects.toThrow("cooldown_out_of_bounds")
    })

    it("upserts within transaction & audits", async () => {
      const upsertSpy = vi.fn().mockResolvedValue({
        patientId: 1,
        ...ALERT_THRESHOLD_DEFAULTS,
        cooldownMinutes: 60,
      })
      const auditSpy = vi.fn().mockResolvedValue({})
      const mockTx = {
        alertThresholdConfig: { upsert: upsertSpy },
        auditLog: { create: auditSpy },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      await alertThresholdService.upsert(1, { cooldownMinutes: 60 }, 99)
      expect(upsertSpy).toHaveBeenCalled()
      expect(auditSpy).toHaveBeenCalled()
    })
  })
})
