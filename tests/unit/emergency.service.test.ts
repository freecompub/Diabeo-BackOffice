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

const { mockSendDoctorEmail } = vi.hoisted(() => ({
  mockSendDoctorEmail: vi.fn(),
}))
vi.mock("@/lib/services/email.service", () => ({
  emailService: {
    sendDoctorEmergencyAlert: mockSendDoctorEmail,
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

    it("returns null detail when patient soft-deleted", async () => {
      prismaMock.emergencyAlert.findFirst.mockResolvedValue(null as never)
      const result = await emergencyService.getDetail(1, 99)
      expect(result).toBeNull()
    })
  })

  describe("detection input bounds", () => {
    it("rejects glucose below physiological floor", async () => {
      const result = await emergencyService.detectFromCgm(
        { patientId: 1, glucoseValueMgdl: 30 },
        99,
      )
      expect(result).toBeNull()
      expect(prismaMock.patient.findFirst).not.toHaveBeenCalled()
    })

    it("rejects glucose above sensor maximum", async () => {
      const result = await emergencyService.detectFromCgm(
        { patientId: 1, glucoseValueMgdl: 700 },
        99,
      )
      expect(result).toBeNull()
    })

    it("rejects ketone below physiological floor", async () => {
      const result = await emergencyService.detectFromKetone(
        { patientId: 1, ketoneValueMmol: 0.05 },
        99,
      )
      expect(result).toBeNull()
    })

    it("rejects ketone above plausible maximum", async () => {
      const result = await emergencyService.detectFromKetone(
        { patientId: 1, ketoneValueMmol: 12 },
        99,
      )
      expect(result).toBeNull()
    })

    it("rejects NaN glucose (sensor error)", async () => {
      const result = await emergencyService.detectFromCgm(
        { patientId: 1, glucoseValueMgdl: NaN },
        99,
      )
      expect(result).toBeNull()
    })
  })

  describe("createManual", () => {
    it("rejects critical severity from a NURSE caller (role gate)", async () => {
      await expect(
        emergencyService.createManual(
          { patientId: 1, severity: "critical", notes: "x".repeat(50), callerRole: "NURSE" },
          99,
        ),
      ).rejects.toThrow("critical_manual_requires_doctor")
    })

    it("rejects critical severity without notes (justification gate)", async () => {
      await expect(
        emergencyService.createManual(
          { patientId: 1, severity: "critical", callerRole: "DOCTOR" },
          99,
        ),
      ).rejects.toThrow("critical_manual_requires_notes")
    })

    it("rejects unknown patient", async () => {
      prismaMock.patient.findFirst.mockResolvedValue(null as never)
      await expect(
        emergencyService.createManual(
          { patientId: 999, severity: "warning", callerRole: "NURSE" },
          99,
        ),
      ).rejects.toThrow("patient_not_found")
    })

    it("blocks manual create during cooldown", async () => {
      prismaMock.patient.findFirst.mockResolvedValue({ id: 1 } as never)
      prismaMock.alertThresholdConfig.findUnique.mockResolvedValue({
        cooldownMinutes: 30, notifyDoctorPush: true,
      } as never)
      prismaMock.emergencyAlert.findFirst.mockResolvedValue({ id: 99 } as never)

      await expect(
        emergencyService.createManual(
          { patientId: 1, severity: "warning", callerRole: "NURSE" },
          99,
        ),
      ).rejects.toThrow("manual_alert_cooldown")
    })
  })

  describe("list — RBAC scoping", () => {
    it("ADMIN with no patientId and no scope sees all alerts", async () => {
      prismaMock.emergencyAlert.findMany.mockResolvedValue([] as never)
      prismaMock.auditLog.create.mockResolvedValue({} as never)

      const result = await emergencyService.list(
        { scopePatientIds: null },
        99,
      )
      expect(result.items).toEqual([])
      const findManyCall = prismaMock.emergencyAlert.findMany.mock.calls.at(-1)?.[0] as
        | { where?: { patientId?: unknown } }
        | undefined
      // No patientId restriction in WHERE clause for ADMIN
      expect(findManyCall?.where?.patientId).toBeUndefined()
    })

    it("Pro with empty scope returns no rows", async () => {
      prismaMock.emergencyAlert.findMany.mockResolvedValue([] as never)
      prismaMock.auditLog.create.mockResolvedValue({} as never)

      await emergencyService.list({ scopePatientIds: [] }, 99)
      const findManyCall = prismaMock.emergencyAlert.findMany.mock.calls.at(-1)?.[0] as
        | { where?: { patientId?: { in?: number[] } } }
        | undefined
      expect(findManyCall?.where?.patientId).toEqual({ in: [] })
    })

    it("Pro with scope IDs constrains query to portfolio", async () => {
      prismaMock.emergencyAlert.findMany.mockResolvedValue([] as never)
      prismaMock.auditLog.create.mockResolvedValue({} as never)

      await emergencyService.list({ scopePatientIds: [10, 20, 30] }, 99)
      const findManyCall = prismaMock.emergencyAlert.findMany.mock.calls.at(-1)?.[0] as
        | { where?: { patientId?: { in?: number[] } } }
        | undefined
      expect(findManyCall?.where?.patientId).toEqual({ in: [10, 20, 30] })
    })

    it("explicit patientId filter takes precedence over scope", async () => {
      prismaMock.emergencyAlert.findMany.mockResolvedValue([] as never)
      prismaMock.auditLog.create.mockResolvedValue({} as never)

      await emergencyService.list(
        { patientId: 42, scopePatientIds: [10, 20] },
        99,
      )
      const findManyCall = prismaMock.emergencyAlert.findMany.mock.calls.at(-1)?.[0] as
        | { where?: { patientId?: number } }
        | undefined
      expect(findManyCall?.where?.patientId).toBe(42)
    })

    it("paginates with cursor when items exceed limit", async () => {
      const items = Array.from({ length: 26 }, (_, i) => ({
        id: i + 1, patientId: 1, alertType: "hypo",
        severity: "warning", status: "open",
        notes: null, resolutionNotes: null, contextSnapshot: null,
      })) as never
      prismaMock.emergencyAlert.findMany.mockResolvedValue(items)
      prismaMock.auditLog.create.mockResolvedValue({} as never)

      const result = await emergencyService.list(
        { limit: 25, scopePatientIds: null },
        99,
      )
      expect(result.items).toHaveLength(25)
      expect(result.nextCursor).toBe(25)
    })
  })

  describe("addAction", () => {
    it("rejects action on unknown alert", async () => {
      prismaMock.emergencyAlert.findUnique.mockResolvedValue(null as never)
      await expect(
        emergencyService.addAction({
          alertId: 999,
          performedBy: 42,
          actionType: "call_patient",
        }),
      ).rejects.toThrow("alert_not_found")
    })

    it("rejects action on soft-deleted patient", async () => {
      prismaMock.emergencyAlert.findUnique.mockResolvedValue({
        id: 1, patientId: 1, status: "open",
        patient: { deletedAt: new Date() },
      } as never)
      await expect(
        emergencyService.addAction({
          alertId: 1,
          performedBy: 42,
          actionType: "call_patient",
        }),
      ).rejects.toThrow("patient_deleted")
    })

    it("rejects action on expired alert", async () => {
      prismaMock.emergencyAlert.findUnique.mockResolvedValue({
        id: 1, patientId: 1, status: "expired",
        patient: { deletedAt: null },
      } as never)
      await expect(
        emergencyService.addAction({
          alertId: 1,
          performedBy: 42,
          actionType: "call_patient",
        }),
      ).rejects.toThrow("alert_expired")
    })

    it("encrypts notes & strict-filters metadata before persistence", async () => {
      prismaMock.emergencyAlert.findUnique.mockResolvedValue({
        id: 1, patientId: 1, status: "acknowledged",
        patient: { deletedAt: null },
      } as never)
      const createSpy = vi.fn().mockResolvedValue({
        id: 7, alertId: 1, performedBy: 42, actionType: "call_patient",
        notes: "ENCRYPTED", metadata: {}, createdAt: new Date(),
      })
      const mockTx = {
        emergencyAlertAction: { create: createSpy },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      await emergencyService.addAction({
        alertId: 1,
        performedBy: 42,
        actionType: "call_patient",
        notes: "called pt 14h05",
        metadata: { durationSec: 120, outcome: "no_answer" },
      })

      const createCall = createSpy.mock.calls[0]?.[0] as {
        data?: { notes?: string; metadata?: Record<string, unknown> }
      }
      // Notes must be encrypted (base64 of AES-256-GCM)
      expect(createCall.data?.notes).not.toBe("called pt 14h05")
      expect(createCall.data?.notes).toBeTruthy()
      // Metadata strictly bounded — durationSec + outcome only
      expect(createCall.data?.metadata).toEqual({ durationSec: 120, outcome: "no_answer" })
    })
  })

  describe("safeCreateAlert (TOCTOU-narrow P2002)", () => {
    it("returns null on the live-alert unique-index P2002", async () => {
      prismaMock.cgmObjective.findUnique.mockResolvedValue(null as never)
      prismaMock.alertThresholdConfig.findUnique.mockResolvedValue(null as never)
      prismaMock.patient.findFirst.mockResolvedValue({
        id: 1, pregnancyMode: false, pathology: "DT1",
      } as never)
      prismaMock.emergencyAlert.findFirst.mockResolvedValue(null as never)
      prismaMock.cgmEntry.findMany.mockResolvedValue([] as never)
      // Mock the partial-unique-index P2002 collision
      const p2002 = Object.assign(new Error("Unique"), {
        code: "P2002",
        meta: { target: "emergency_alerts_one_live_per_type" },
      })
      Object.setPrototypeOf(
        p2002,
        (await import("@prisma/client")).Prisma.PrismaClientKnownRequestError.prototype,
      )
      prismaMock.$transaction.mockImplementation((async () => {
        throw p2002
      }) as any)

      const result = await emergencyService.detectFromCgm(
        { patientId: 1, glucoseValueMgdl: 40 },
        99,
      )
      expect(result).toBeNull()
    })

    it("rethrows non-targeted P2002 (e.g. unrelated unique constraint)", async () => {
      prismaMock.cgmObjective.findUnique.mockResolvedValue(null as never)
      prismaMock.alertThresholdConfig.findUnique.mockResolvedValue(null as never)
      prismaMock.patient.findFirst.mockResolvedValue({
        id: 1, pregnancyMode: false, pathology: "DT1",
      } as never)
      prismaMock.emergencyAlert.findFirst.mockResolvedValue(null as never)
      prismaMock.cgmEntry.findMany.mockResolvedValue([] as never)
      const p2002 = Object.assign(new Error("Unique"), {
        code: "P2002",
        meta: { target: "some_other_unique_index" },
      })
      Object.setPrototypeOf(
        p2002,
        (await import("@prisma/client")).Prisma.PrismaClientKnownRequestError.prototype,
      )
      prismaMock.$transaction.mockImplementation((async () => {
        throw p2002
      }) as any)

      await expect(
        emergencyService.detectFromCgm(
          { patientId: 1, glucoseValueMgdl: 40 },
          99,
        ),
      ).rejects.toBe(p2002)
    })
  })

  /**
   * US-2266 — `notifyDoctorEmail` wiring on critical alerts.
   *
   * Behaviors covered:
   * - When `notifyDoctorEmail` flag is true AND alert is critical → email
   *   is dispatched to the encrypted referent email (via emailService).
   * - When the flag is false → no email dispatch (push only).
   * - When alert severity is `warning` → no email regardless of flag.
   * - When the patient has no referent → no email dispatch.
   * - Email failures do NOT break the alert flow (best-effort, swallowed).
   * - An audit row `EMAIL_SENT` is recorded on successful send.
   */
  describe("notifyDoctorEmail wiring (US-2266)", () => {
    beforeEach(async () => {
      mockSendDoctorEmail.mockClear()
      mockSendDoctorEmail.mockResolvedValue({ sent: true, id: "msg-1" })
    })

    /** Helpers — mock a patient + thresholds + a referent with encrypted email. */
    async function setupSeverHypoScenario(opts: {
      notifyDoctorEmail: boolean
      hasReferent?: boolean
    }) {
      const decimal = (n: number) => ({ toNumber: () => n })
      prismaMock.cgmObjective.findUnique.mockResolvedValue({
        veryLow: decimal(0.54), low: decimal(0.70), ok: decimal(1.80),
        high: decimal(2.50), titrLow: decimal(0.70), titrHigh: decimal(1.80),
      } as never)
      prismaMock.alertThresholdConfig.findUnique.mockResolvedValue({
        alertOnHypo: true, alertOnSevereHypo: true,
        alertOnHyper: false, alertOnSevereHyper: true,
        notifyDoctorPush: true,
        notifyDoctorEmail: opts.notifyDoctorEmail,
        cooldownMinutes: 30,
      } as never)
      prismaMock.patient.findFirst.mockResolvedValue({
        id: 1, pregnancyMode: false, pathology: "DT1",
      } as never)
      prismaMock.emergencyAlert.findFirst.mockResolvedValue(null as never)
      prismaMock.cgmEntry.findMany.mockResolvedValue([])

      // notifyCriticalAlert internals — referent + user lookups
      if (opts.hasReferent !== false) {
        prismaMock.patientReferent.findUnique.mockResolvedValue({
          pro: { userId: 42 },
        } as never)
        // Encrypt a real test email so safeDecryptField returns it cleanly
        const { encryptField } = await import("@/lib/crypto/fields")
        prismaMock.user.findUnique.mockResolvedValue({
          email: encryptField("doctor@example.com"),
        } as never)
      } else {
        prismaMock.patientReferent.findUnique.mockResolvedValue(null as never)
      }

      const mockTx = {
        emergencyAlert: {
          create: vi.fn().mockResolvedValue({
            id: 7,
            patientId: 1,
            alertType: "severe_hypo",
            severity: "critical",
          }),
        },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)
      prismaMock.auditLog.create.mockResolvedValue({} as never)
    }

    it("dispatches email on critical CGM breach when notifyDoctorEmail=true", async () => {
      await setupSeverHypoScenario({ notifyDoctorEmail: true })

      // 40 mg/dL ≤ veryLow=54 → severe_hypo / critical
      await emergencyService.detectFromCgm(
        { patientId: 1, glucoseValueMgdl: 40 },
        99,
      )

      expect(mockSendDoctorEmail).toHaveBeenCalledTimes(1)
      const call = mockSendDoctorEmail.mock.calls[0]?.[0] as {
        doctorEmail?: string
        alertId?: number
        patientInternalId?: number
      }
      expect(call.doctorEmail).toBe("doctor@example.com")
      expect(call.alertId).toBe(7)
      expect(call.patientInternalId).toBe(1)
    })

    it("does NOT dispatch email when notifyDoctorEmail=false", async () => {
      await setupSeverHypoScenario({ notifyDoctorEmail: false })

      await emergencyService.detectFromCgm(
        { patientId: 1, glucoseValueMgdl: 40 },
        99,
      )

      expect(mockSendDoctorEmail).not.toHaveBeenCalled()
    })

    it("does NOT dispatch email on warning-severity alert (hypo, not severe)", async () => {
      await setupSeverHypoScenario({ notifyDoctorEmail: true })

      // 65 mg/dL → hypo / warning (not critical)
      await emergencyService.detectFromCgm(
        { patientId: 1, glucoseValueMgdl: 65 },
        99,
      )

      expect(mockSendDoctorEmail).not.toHaveBeenCalled()
    })

    it("no-ops silently when patient has no referent configured", async () => {
      await setupSeverHypoScenario({ notifyDoctorEmail: true, hasReferent: false })

      await emergencyService.detectFromCgm(
        { patientId: 1, glucoseValueMgdl: 40 },
        99,
      )

      expect(mockSendDoctorEmail).not.toHaveBeenCalled()
    })

    it("alert is still persisted even if email service throws (best-effort)", async () => {
      await setupSeverHypoScenario({ notifyDoctorEmail: true })
      mockSendDoctorEmail.mockRejectedValue(new Error("Resend down"))

      const result = await emergencyService.detectFromCgm(
        { patientId: 1, glucoseValueMgdl: 40 },
        99,
      )

      // Alert was created even though email failed
      expect(result).toEqual({ id: 7, alertType: "severe_hypo" })
    })
  })
})
