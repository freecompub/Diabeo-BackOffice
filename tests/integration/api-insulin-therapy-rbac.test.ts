/**
 * Test suite: RBAC on insulin-therapy mutation routes (US-2648a, supersedes US-SEC-001)
 *
 * Clinical / security behavior tested:
 * - PUT /api/insulin-therapy/settings, POST /sensitivity-factors, POST /carb-ratios
 *   and POST/DELETE /basal-config/pump-slots MUST reject role VIEWER (the patient)
 *   AND role NURSE with HTTP 403 forbidden.
 * - **US-2648a**: direct writes of dose-driving config are now **DOCTOR only**. A
 *   NURSE (and a patient) no longer writes directly — they go through a validated
 *   proposal (POST /api/adjustment-proposals). Only DOCTOR writes directly.
 * - These parameters feed `insulinService.calculateBolus` — an unqualified self-
 *   mutation of ISF/ICR could bias dose suggestions toward hypoglycemia.
 *
 * Associated risks:
 * - A regression relaxing `requireRole(req, "DOCTOR")` back to NURSE (or to
 *   `requireAuth`) would re-open the privilege escalation. These tests are the
 *   regression guard (US-SEC-001 audit 2026-04-15, durci par US-2648a).
 */

import { describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.stubEnv("UPSTASH_REDIS_REST_URL", "")
vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "")
vi.mock("@/lib/db/client", () => ({ prisma: {} }))
vi.mock("@/lib/gdpr", () => ({ requireGdprConsent: vi.fn().mockResolvedValue(true) }))
vi.mock("@/lib/access-control", () => ({
  resolvePatientId: vi.fn().mockResolvedValue(42),
}))
vi.mock("@/lib/services/insulin.service", () => ({
  insulinService: {
    calculateBolus: vi.fn().mockResolvedValue({
      mealBolus: 5, rawCorrectionDose: 0, iobAdjustment: 0, correctionDose: 0,
      recommendedDose: 5, wasCapped: false, warnings: [],
      requiresHypoTreatmentFirst: false, deliveryMethod: "pump",
    }),
  },
  InvalidTherapyConfigError: class extends Error { code = "invalidTherapyConfig" as const },
}))
vi.mock("@/lib/services/insulin-therapy.service", () => ({
  insulinTherapyService: {
    upsertSettings: vi.fn().mockResolvedValue({ id: 1 }),
    getSettings: vi.fn().mockResolvedValue({ id: 1 }),
    createIsf: vi.fn().mockResolvedValue({ id: "isf-1" }),
    createIcr: vi.fn().mockResolvedValue({ id: "icr-1" }),
    deleteSettings: vi.fn().mockResolvedValue({ deleted: true }),
    createPumpSlot: vi.fn().mockResolvedValue({ id: "slot-1" }),
    deletePumpSlot: vi.fn().mockResolvedValue({ deleted: true }),
    updateIsf: vi.fn().mockResolvedValue({ updated: true }),
    updateIcr: vi.fn().mockResolvedValue({ updated: true }),
    updatePumpSlot: vi.fn().mockResolvedValue({ updated: true }),
  },
  INSULIN_BOUNDS: {
    INSULIN_ACTION_MIN: 2,
    INSULIN_ACTION_MAX: 8,
    ISF_GL_MIN: 0.20,
    ISF_GL_MAX: 1.00,
    ICR_MIN: 5.0,
    ICR_MAX: 20.0,
    BASAL_MIN: 0.05,
    BASAL_MAX: 10.0,
    PUMP_BASAL_INCREMENT: 0.05,
  },
}))
vi.mock("@/lib/services/audit.service", () => ({
  extractRequestContext: () => ({ ipAddress: "1.2.3.4", userAgent: "vitest", requestId: "r" }),
}))

const { PUT: settingsPut, DELETE: settingsDelete } = await import("@/app/api/insulin-therapy/settings/route")
const { POST: isfPost, PATCH: isfPatch } = await import("@/app/api/insulin-therapy/sensitivity-factors/route")
const { POST: icrPost, PATCH: icrPatch } = await import("@/app/api/insulin-therapy/carb-ratios/route")
const { POST: pumpSlotPost, DELETE: pumpSlotDelete, PATCH: pumpSlotPatch } = await import(
  "@/app/api/insulin-therapy/basal-config/pump-slots/route"
)
const { POST: bolusPost } = await import("@/app/api/insulin-therapy/calculate-bolus/route")

function req(url: string, body: unknown, role: string): NextRequest {
  return new NextRequest(new URL(url), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-id": "7",
      "x-user-role": role,
    },
    body: JSON.stringify(body),
  })
}

function reqMethod(
  url: string,
  method: "DELETE" | "PUT" | "PATCH",
  role: string,
  body?: Record<string, unknown>,
): NextRequest {
  return new NextRequest(new URL(url), {
    method,
    headers: {
      "content-type": "application/json",
      "x-user-id": "7",
      "x-user-role": role,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

const validSettingsBody = {
  bolusInsulinBrand: "humalog",
  insulinActionDuration: 4,
  deliveryMethod: "pump",
}
const validIsfBody = { startHour: 6, endHour: 12, sensitivityFactorGl: 0.5 }
const validIcrBody = { startHour: 6, endHour: 12, gramsPerUnit: 10 }

describe("US-SEC-001 — insulin-therapy mutation routes RBAC", () => {
  describe("PUT /api/insulin-therapy/settings", () => {
    it("REJECTS VIEWER (patient) with 403 — must not self-mutate ISF-driving config", async () => {
      const res = await settingsPut(req("http://localhost/api/insulin-therapy/settings", validSettingsBody, "VIEWER"))
      expect(res.status).toBe(403)
    })

    it("REJECTS NURSE with 403 (US-2648a — proposition, pas écriture directe)", async () => {
      const res = await settingsPut(req("http://localhost/api/insulin-therapy/settings", validSettingsBody, "NURSE"))
      expect(res.status).toBe(403)
    })

    it("accepts DOCTOR", async () => {
      const res = await settingsPut(req("http://localhost/api/insulin-therapy/settings", validSettingsBody, "DOCTOR"))
      expect(res.status).toBe(200)
    })
  })

  describe("POST /api/insulin-therapy/sensitivity-factors", () => {
    it("REJECTS VIEWER (patient) with 403 — must not self-mutate ISF", async () => {
      const res = await isfPost(req("http://localhost/api/insulin-therapy/sensitivity-factors", validIsfBody, "VIEWER"))
      expect(res.status).toBe(403)
    })

    it("REJECTS NURSE with 403 (US-2648a)", async () => {
      const res = await isfPost(req("http://localhost/api/insulin-therapy/sensitivity-factors", validIsfBody, "NURSE"))
      expect(res.status).toBe(403)
    })

    it("accepts DOCTOR", async () => {
      const res = await isfPost(req("http://localhost/api/insulin-therapy/sensitivity-factors", validIsfBody, "DOCTOR"))
      expect(res.status).toBe(201)
    })
  })

  describe("POST /api/insulin-therapy/carb-ratios", () => {
    it("REJECTS VIEWER (patient) with 403 — must not self-mutate ICR", async () => {
      const res = await icrPost(req("http://localhost/api/insulin-therapy/carb-ratios", validIcrBody, "VIEWER"))
      expect(res.status).toBe(403)
    })

    it("REJECTS NURSE with 403 (US-2648a)", async () => {
      const res = await icrPost(req("http://localhost/api/insulin-therapy/carb-ratios", validIcrBody, "NURSE"))
      expect(res.status).toBe(403)
    })

    it("accepts DOCTOR", async () => {
      const res = await icrPost(req("http://localhost/api/insulin-therapy/carb-ratios", validIcrBody, "DOCTOR"))
      expect(res.status).toBe(201)
    })
  })

  // ─────────────────────────────────────────────────────────────────────
  // Symmetry coverage on pre-existing role-guarded routes (DOCTOR/NURSE).
  // Not part of the audit fix itself — guards that the existing posture
  // doesn't silently regress alongside future changes.
  // ─────────────────────────────────────────────────────────────────────

  describe("DELETE /api/insulin-therapy/settings (DOCTOR only)", () => {
    it("REJECTS NURSE with 403", async () => {
      const url = "http://localhost/api/insulin-therapy/settings?patientId=42"
      const res = await settingsDelete(reqMethod(url, "DELETE", "NURSE"))
      expect(res.status).toBe(403)
    })

    it("REJECTS VIEWER with 403", async () => {
      const url = "http://localhost/api/insulin-therapy/settings?patientId=42"
      const res = await settingsDelete(reqMethod(url, "DELETE", "VIEWER"))
      expect(res.status).toBe(403)
    })

    it("accepts DOCTOR", async () => {
      const url = "http://localhost/api/insulin-therapy/settings?patientId=42"
      const res = await settingsDelete(reqMethod(url, "DELETE", "DOCTOR"))
      expect(res.status).toBe(200)
    })
  })

  describe("POST + DELETE /api/insulin-therapy/basal-config/pump-slots (DOCTOR only)", () => {
    const validSlot = { startTime: "06:00", endTime: "12:00", rate: 0.95 }

    it("POST REJECTS VIEWER with 403", async () => {
      const res = await pumpSlotPost(req("http://localhost/api/insulin-therapy/basal-config/pump-slots", validSlot, "VIEWER"))
      expect(res.status).toBe(403)
    })

    it("POST REJECTS NURSE with 403 (US-2648a)", async () => {
      const res = await pumpSlotPost(req("http://localhost/api/insulin-therapy/basal-config/pump-slots", validSlot, "NURSE"))
      expect(res.status).toBe(403)
    })

    it("POST accepts DOCTOR", async () => {
      const res = await pumpSlotPost(req("http://localhost/api/insulin-therapy/basal-config/pump-slots", validSlot, "DOCTOR"))
      // 201 (created) or 404 (no settings configured for patientId 42 in mock chain) — either way NOT 403
      expect([201, 404]).toContain(res.status)
    })

    it("DELETE REJECTS VIEWER with 403", async () => {
      const url = "http://localhost/api/insulin-therapy/basal-config/pump-slots?id=123e4567-e89b-42d3-a456-426614174000&patientId=42"
      const res = await pumpSlotDelete(reqMethod(url, "DELETE", "VIEWER"))
      expect(res.status).toBe(403)
    })

    it("DELETE REJECTS NURSE with 403 (US-2648a)", async () => {
      const url = "http://localhost/api/insulin-therapy/basal-config/pump-slots?id=123e4567-e89b-42d3-a456-426614174000&patientId=42"
      const res = await pumpSlotDelete(reqMethod(url, "DELETE", "NURSE"))
      expect(res.status).toBe(403)
    })

    it("DELETE accepts DOCTOR", async () => {
      const url = "http://localhost/api/insulin-therapy/basal-config/pump-slots?id=123e4567-e89b-42d3-a456-426614174000&patientId=42"
      const res = await pumpSlotDelete(reqMethod(url, "DELETE", "DOCTOR"))
      // Not 403 — the role guard let the request through. 404 acceptable
      // because mock chain doesn't surface a matching slot.
      expect([200, 404]).toContain(res.status)
    })
  })

  // ─────────────────────────────────────────────────────────────────────
  // US-2648b — PATCH (édition DIRECTE d'un créneau) : DOCTOR only, NURSE/VIEWER 403.
  // ─────────────────────────────────────────────────────────────────────
  describe("PATCH /api/insulin-therapy/* (édition directe, DOCTOR only)", () => {
    const uuid = "123e4567-e89b-42d3-a456-426614174000"

    it("ISF PATCH REJECTS NURSE with 403", async () => {
      const res = await isfPatch(reqMethod("http://localhost/api/insulin-therapy/sensitivity-factors", "PATCH", "NURSE", { id: uuid, sensitivityFactorGl: 0.5 }))
      expect(res.status).toBe(403)
    })
    it("ISF PATCH accepts DOCTOR", async () => {
      const res = await isfPatch(reqMethod("http://localhost/api/insulin-therapy/sensitivity-factors", "PATCH", "DOCTOR", { id: uuid, sensitivityFactorGl: 0.5 }))
      expect(res.status).toBe(200)
    })
    it("ICR PATCH REJECTS VIEWER with 403", async () => {
      const res = await icrPatch(reqMethod("http://localhost/api/insulin-therapy/carb-ratios", "PATCH", "VIEWER", { id: uuid, gramsPerUnit: 10 }))
      expect(res.status).toBe(403)
    })
    it("ICR PATCH accepts DOCTOR", async () => {
      const res = await icrPatch(reqMethod("http://localhost/api/insulin-therapy/carb-ratios", "PATCH", "DOCTOR", { id: uuid, gramsPerUnit: 10 }))
      expect(res.status).toBe(200)
    })
    it("basal PATCH accepts DOCTOR avec débit sur incrément (0.95)", async () => {
      const res = await pumpSlotPatch(reqMethod("http://localhost/api/insulin-therapy/basal-config/pump-slots", "PATCH", "DOCTOR", { id: uuid, rate: 0.95 }))
      expect(res.status).toBe(200)
    })
    it("basal PATCH rejette un débit hors incrément (0.37) → 400", async () => {
      const res = await pumpSlotPatch(reqMethod("http://localhost/api/insulin-therapy/basal-config/pump-slots", "PATCH", "DOCTOR", { id: uuid, rate: 0.37 }))
      expect(res.status).toBe(400)
    })
    it("basal PATCH REJECTS NURSE with 403", async () => {
      const res = await pumpSlotPatch(reqMethod("http://localhost/api/insulin-therapy/basal-config/pump-slots", "PATCH", "NURSE", { id: uuid, rate: 0.95 }))
      expect(res.status).toBe(403)
    })
  })

  // ─────────────────────────────────────────────────────────────────────
  // Contract test: VIEWER (the patient) IS allowed to call /calculate-bolus.
  // Documents the ADR #13 carve-out (read-model simulation, never auto-
  // injected). Prevents an over-eager future hardening from breaking the
  // patient-facing flow by requiring NURSE+ here too.
  // ─────────────────────────────────────────────────────────────────────
  describe("POST /api/insulin-therapy/calculate-bolus (VIEWER allowed by design)", () => {
    const validBolusBody = { currentGlucoseGl: 1.5, carbsGrams: 60 }

    it("ALLOWS VIEWER (the patient) — documented ADR #13 carve-out", async () => {
      const res = await bolusPost(req("http://localhost/api/insulin-therapy/calculate-bolus", validBolusBody, "VIEWER"))
      // Crucially NOT 403 — the patient must be able to simulate their own
      // bolus (suggestion, never auto-injected per ADR #13).
      expect(res.status).not.toBe(403)
      expect([200, 201]).toContain(res.status)
    })
  })
})
