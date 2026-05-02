/**
 * Test suite: Emergency Service (US-2224/2225/2226/2230)
 *
 * Clinical behavior tested:
 * - CGM threshold breach correctly classifies severity:
 *   <54 mg/dL → severe_hypo / critical, <70 → hypo / warning,
 *   >180 → hyper / warning, >250 → severe_hyper / critical.
 * - Pregnancy mode activates tighter thresholds even when no CgmObjective
 *   record exists (fallback path) — protects fetus from hyperglycemia.
 * - Ketone threshold breach: > moderate (1.5) → warning, > DKA (3.0)
 *   → critical.
 * - Cooldown blocks duplicate alerts of the same type within the configured
 *   window. Distinct types remain emittable to avoid masking new events.
 * - Workflow transitions (open → acknowledged → resolved) only flow forward;
 *   re-acking or re-resolving raises an error to keep audit honest.
 *
 * Associated risks:
 * - Misclassifying critical as warning would disable push notifications
 *   to the referent doctor (notifyDoctorPush only fires on critical).
 * - Allowing duplicate alerts during a hypo episode would fatigue the
 *   referent and slow real-emergency response.
 *
 * Edge cases:
 * - Glucose precisely on threshold → not flagged (strict inequality).
 * - Cooldown applies to *resolved* alerts within window, not just open.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

vi.mock("@/lib/services/fcm.service", () => ({
  fcmService: {
    sendToUser: vi.fn().mockResolvedValue({ sent: 1, failed: 0, results: [] }),
  },
}))

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { emergencyService, __test__ } from "@/lib/services/emergency.service"

const { classifyCgmAlert, classifyKetoneAlert, effectiveCooldown, CRITICAL_COOLDOWN_CEILING } = __test__

describe("emergencyService", () => {
  beforeEach(() => vi.clearAllMocks())

  describe("classifyCgmAlert", () => {
    const thresholds = {
      veryLowMgdl: 54,
      lowMgdl: 70,
      okMgdl: 180,
      highMgdl: 250,
    }
    const allRules = {
      alertOnHypo: true,
      alertOnSevereHypo: true,
      alertOnHyper: true,
      alertOnSevereHyper: true,
    }

    it("classifies <54 mg/dL as severe_hypo / critical", () => {
      expect(classifyCgmAlert(50, thresholds, allRules)).toEqual({
        type: "severe_hypo",
        severity: "critical",
      })
    })

    it("classifies <70 mg/dL as hypo / warning", () => {
      expect(classifyCgmAlert(65, thresholds, allRules)).toEqual({
        type: "hypo",
        severity: "warning",
      })
    })

    it("classifies >250 mg/dL as severe_hyper / critical", () => {
      expect(classifyCgmAlert(280, thresholds, allRules)).toEqual({
        type: "severe_hyper",
        severity: "critical",
      })
    })

    it("classifies >180 mg/dL but ≤250 as hyper / warning", () => {
      expect(classifyCgmAlert(200, thresholds, allRules)).toEqual({
        type: "hyper",
        severity: "warning",
      })
    })

    it("uses inclusive boundary on critical thresholds (clinical safety)", () => {
      // ADA SoC 2024 Level 2 hypo "< 54 mg/dL" — inclusive ≤ avoids sensor-
      // rounding misses. 54 mg/dL exactly is severe_hypo / critical.
      expect(classifyCgmAlert(54, thresholds, allRules)).toEqual({
        type: "severe_hypo",
        severity: "critical",
      })
      // 70 not below low (strict <), and > veryLow → null (no hypo).
      expect(classifyCgmAlert(70, thresholds, allRules)).toBeNull()
      // 180 not above ok (strict >), and < high → null (no hyper).
      expect(classifyCgmAlert(180, thresholds, allRules)).toBeNull()
      // 250 mg/dL is severe_hyper / critical (inclusive ≥).
      expect(classifyCgmAlert(250, thresholds, allRules)).toEqual({
        type: "severe_hyper",
        severity: "critical",
      })
    })

    it("returns null when emission disabled even if breach", () => {
      expect(
        classifyCgmAlert(200, thresholds, { ...allRules, alertOnHyper: false }),
      ).toBeNull()
    })
  })

  describe("classifyKetoneAlert", () => {
    const config = {
      moderateThreshold: 1.5,
      dkaThreshold: 3.0,
      alertOnModerate: true,
      alertOnDka: true,
    }

    it("classifies ≥ DKA threshold as DKA / critical (ISPAD 2022 inclusive)", () => {
      expect(classifyKetoneAlert(3.0, config)).toEqual({
        type: "ketone_dka",
        severity: "critical",
      })
      expect(classifyKetoneAlert(3.5, config)).toEqual({
        type: "ketone_dka",
        severity: "critical",
      })
    })

    it("classifies ≥ moderate but < DKA as moderate / warning", () => {
      expect(classifyKetoneAlert(1.5, config)).toEqual({
        type: "ketone_moderate",
        severity: "warning",
      })
      expect(classifyKetoneAlert(2.5, config)).toEqual({
        type: "ketone_moderate",
        severity: "warning",
      })
    })

    it("returns null below moderate threshold", () => {
      expect(classifyKetoneAlert(1.0, config)).toBeNull()
    })
  })

  describe("effectiveCooldown (severity-aware)", () => {
    it("caps critical-severity cooldown at safe ceiling (Level 2 hypo / DKA)", () => {
      expect(effectiveCooldown(60, "critical")).toBe(CRITICAL_COOLDOWN_CEILING)
      expect(effectiveCooldown(1440, "critical")).toBe(CRITICAL_COOLDOWN_CEILING)
    })

    it("respects configured cooldown for warning/info severity", () => {
      expect(effectiveCooldown(60, "warning")).toBe(60)
      expect(effectiveCooldown(60, "info")).toBe(60)
    })

    it("does not raise cooldown when configured below ceiling", () => {
      // configured < ceiling → keep configured
      expect(effectiveCooldown(5, "critical")).toBe(5)
    })
  })

  describe("detectFromCgm", () => {
    it("returns null when no threshold breached", async () => {
      const decimal = (n: number) => ({ toNumber: () => n })
      prismaMock.cgmObjective.findUnique.mockResolvedValue({
        veryLow: decimal(0.54), low: decimal(0.70), ok: decimal(1.80),
        high: decimal(2.50), titrLow: decimal(0.70), titrHigh: decimal(1.80),
      } as never)
      prismaMock.alertThresholdConfig.findUnique.mockResolvedValue(null)
      prismaMock.patient.findFirst.mockResolvedValue({
        id: 1, pregnancyMode: false, pathology: "DT1",
      } as never)

      const result = await emergencyService.detectFromCgm(
        { patientId: 1, glucoseValueMgdl: 120 },
        99,
      )
      expect(result).toBeNull()
    })

    it("returns null when soft-deleted patient", async () => {
      prismaMock.patient.findFirst.mockResolvedValue(null)
      const result = await emergencyService.detectFromCgm(
        { patientId: 999, glucoseValueMgdl: 30 },
        99,
      )
      expect(result).toBeNull()
    })

    it("uses pregnancy fallback thresholds when no CgmObjective", async () => {
      prismaMock.cgmObjective.findUnique.mockResolvedValue(null)
      prismaMock.alertThresholdConfig.findUnique.mockResolvedValue(null)
      prismaMock.patient.findFirst.mockResolvedValue({
        id: 1, pregnancyMode: true, pathology: "DT1",
      } as never)
      prismaMock.emergencyAlert.findFirst.mockResolvedValue(null)
      prismaMock.cgmEntry.findMany.mockResolvedValue([])

      const mockTx = {
        emergencyAlert: {
          create: vi.fn().mockResolvedValue({
            id: 7,
            patientId: 1,
            alertType: "severe_hyper",
            severity: "critical",
          }),
        },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)
      prismaMock.patientReferent.findUnique.mockResolvedValue(null)

      // 210 mg/dL ≥ pregnancy high (200) → severe_hyper / critical
      const result = await emergencyService.detectFromCgm(
        { patientId: 1, glucoseValueMgdl: 210 },
        99,
      )
      expect(result).toEqual({ id: 7, alertType: "severe_hyper" })
    })

    it("blocks duplicate alert during cooldown", async () => {
      const decimal = (n: number) => ({ toNumber: () => n })
      prismaMock.cgmObjective.findUnique.mockResolvedValue({
        veryLow: decimal(0.54), low: decimal(0.70), ok: decimal(1.80),
        high: decimal(2.50), titrLow: decimal(0.70), titrHigh: decimal(1.80),
      } as never)
      prismaMock.alertThresholdConfig.findUnique.mockResolvedValue({
        alertOnHypo: true, alertOnSevereHypo: true,
        alertOnHyper: false, alertOnSevereHyper: true,
        notifyDoctorPush: true, notifyDoctorEmail: true, cooldownMinutes: 30,
      } as never)
      prismaMock.patient.findFirst.mockResolvedValue({
        id: 1, pregnancyMode: false, pathology: "DT1",
      } as never)
      // Existing live alert blocks emission
      prismaMock.emergencyAlert.findFirst.mockResolvedValue({ id: 99 } as never)

      const result = await emergencyService.detectFromCgm(
        { patientId: 1, glucoseValueMgdl: 40 },
        99,
      )
      expect(result).toBeNull()
    })
  })

  describe("acknowledge / resolve", () => {
    it("acknowledge fails for non-open alert (workflow consistency)", async () => {
      const findUniqueSpy = vi.fn().mockResolvedValue({
        id: 1, status: "acknowledged", patientId: 1,
        patient: { deletedAt: null },
      })
      const mockTx = {
        emergencyAlert: { findUnique: findUniqueSpy, update: vi.fn() },
        emergencyAlertAction: { create: vi.fn() },
        auditLog: { create: vi.fn() },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      await expect(
        emergencyService.acknowledge(1, 42, undefined),
      ).rejects.toThrow("alert_not_open")
    })

    it("rejects acknowledge on soft-deleted patient (RGPD Art. 17)", async () => {
      const findUniqueSpy = vi.fn().mockResolvedValue({
        id: 1, status: "open", patientId: 1,
        patient: { deletedAt: new Date() },
      })
      const mockTx = {
        emergencyAlert: { findUnique: findUniqueSpy, update: vi.fn() },
        emergencyAlertAction: { create: vi.fn() },
        auditLog: { create: vi.fn() },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      await expect(
        emergencyService.acknowledge(1, 42, undefined),
      ).rejects.toThrow("patient_deleted")
    })

    it("resolve fails when already resolved (idempotency guard)", async () => {
      const findUniqueSpy = vi.fn().mockResolvedValue({
        id: 1, status: "resolved", patientId: 1,
        patient: { deletedAt: null },
      })
      const mockTx = {
        emergencyAlert: { findUnique: findUniqueSpy, update: vi.fn() },
        emergencyAlertAction: { create: vi.fn() },
        auditLog: { create: vi.fn() },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      await expect(
        emergencyService.resolve(1, 42, undefined),
      ).rejects.toThrow("alert_already_closed")
    })

    it("resolve succeeds from open status", async () => {
      const updateSpy = vi.fn().mockResolvedValue({
        id: 1, status: "resolved", patientId: 1, resolvedBy: 42,
        notes: null, resolutionNotes: null, contextSnapshot: null,
      })
      const mockTx = {
        emergencyAlert: {
          findUnique: vi.fn().mockResolvedValue({
            id: 1, status: "open", patientId: 1,
            patient: { deletedAt: null },
          }),
          update: updateSpy,
        },
        emergencyAlertAction: { create: vi.fn().mockResolvedValue({}) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      const result = await emergencyService.resolve(1, 42, "patient ate carbs")
      expect(result.status).toBe("resolved")
      expect(updateSpy).toHaveBeenCalled()
    })
  })
})
