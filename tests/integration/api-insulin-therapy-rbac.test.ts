/**
 * Test suite: US-SEC-001 — RBAC on insulin-therapy mutation routes
 *
 * Clinical / security behavior tested:
 * - PUT /api/insulin-therapy/settings, POST /api/insulin-therapy/sensitivity-
 *   factors, and POST /api/insulin-therapy/carb-ratios MUST reject role
 *   VIEWER (the patient themselves) with HTTP 403 forbidden.
 * - NURSE and DOCTOR continue to write successfully.
 * - These parameters feed `insulinService.calculateBolus` — a patient
 *   self-mutating their ISF/ICR could bias dose suggestions toward
 *   hypoglycemia. RBAC is the only guard.
 *
 * Associated risks:
 * - A regression replacing `requireRole(req, "NURSE")` with `requireAuth(req)`
 *   would re-open the privilege escalation. These tests are the regression
 *   guard for the audit fix landed 2026-04-15.
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
vi.mock("@/lib/services/insulin-therapy.service", () => ({
  insulinTherapyService: {
    upsertSettings: vi.fn().mockResolvedValue({ id: 1 }),
    getSettings: vi.fn().mockResolvedValue({ id: 1 }),
    createIsf: vi.fn().mockResolvedValue({ id: "isf-1" }),
    createIcr: vi.fn().mockResolvedValue({ id: "icr-1" }),
  },
  INSULIN_BOUNDS: {
    INSULIN_ACTION_MIN: 2,
    INSULIN_ACTION_MAX: 8,
    ISF_GL_MIN: 0.20,
    ISF_GL_MAX: 1.00,
    ICR_MIN: 5.0,
    ICR_MAX: 20.0,
  },
}))
vi.mock("@/lib/services/audit.service", () => ({
  extractRequestContext: () => ({ ipAddress: "1.2.3.4", userAgent: "vitest", requestId: "r" }),
}))

const { PUT: settingsPut } = await import("@/app/api/insulin-therapy/settings/route")
const { POST: isfPost } = await import("@/app/api/insulin-therapy/sensitivity-factors/route")
const { POST: icrPost } = await import("@/app/api/insulin-therapy/carb-ratios/route")

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

    it("accepts NURSE", async () => {
      const res = await settingsPut(req("http://localhost/api/insulin-therapy/settings", validSettingsBody, "NURSE"))
      expect(res.status).toBe(200)
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

    it("accepts NURSE", async () => {
      const res = await isfPost(req("http://localhost/api/insulin-therapy/sensitivity-factors", validIsfBody, "NURSE"))
      expect(res.status).toBe(201)
    })
  })

  describe("POST /api/insulin-therapy/carb-ratios", () => {
    it("REJECTS VIEWER (patient) with 403 — must not self-mutate ICR", async () => {
      const res = await icrPost(req("http://localhost/api/insulin-therapy/carb-ratios", validIcrBody, "VIEWER"))
      expect(res.status).toBe(403)
    })

    it("accepts NURSE", async () => {
      const res = await icrPost(req("http://localhost/api/insulin-therapy/carb-ratios", validIcrBody, "NURSE"))
      expect(res.status).toBe(201)
    })
  })
})
