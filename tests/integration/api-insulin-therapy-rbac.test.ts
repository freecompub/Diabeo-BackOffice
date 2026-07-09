/**
 * Test suite: RBAC on insulin-therapy mutation routes (US-2648a → US-2657 grouped-only).
 *
 * Clinical / security behavior tested:
 * - Les écritures de config pilotant le dosage sont **DOCTOR only**. Un VIEWER (patient) ET un NURSE
 *   sont rejetés 403 ; ils passent par une proposition validée (POST /api/adjustment-proposals) ou, pour
 *   le patient EXPERT, la soumission groupée self-service (PUT /api/patient/insulin-slot-set).
 * - **US-2657 (grouped-only, ADR #23)** : l'édition ISF/ICR/basal se fait EXCLUSIVEMENT en bloc via `PUT`
 *   (« replace the whole set »). Les anciens verbes par-créneau (POST/PATCH sensitivity-factors & carb-ratios ;
 *   POST/PATCH/DELETE pump-slots) sont **retirés** — ces routes n'exposent plus que GET + PUT.
 * - Ces paramètres alimentent `calculateBolus` : une auto-mutation par un rôle non qualifié biaiserait la
 *   suggestion de dose. Ces tests sont le garde anti-régression (US-SEC-001 audit 2026-04-15).
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
    deleteSettings: vi.fn().mockResolvedValue({ deleted: true }),
    // US-2657 grouped-only — seules les voies GROUPÉES subsistent côté écriture.
    replaceSlotSet: vi.fn().mockResolvedValue({ applied: true, count: 1, coverage: { hasGap: false, hasOverlap: false }, supersededProposalIds: [], supersededSetProposalIds: [] }),
    replacePumpSlotSet: vi.fn().mockResolvedValue({ applied: true, count: 1, coverage: { hasGap: false, hasOverlap: false }, supersededProposalIds: [] }),
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
const { PUT: isfPut } = await import("@/app/api/insulin-therapy/sensitivity-factors/route")
const { PUT: icrPut } = await import("@/app/api/insulin-therapy/carb-ratios/route")
const { PUT: pumpSlotPut } = await import("@/app/api/insulin-therapy/basal-config/pump-slots/route")
const { POST: bolusPost } = await import("@/app/api/insulin-therapy/calculate-bolus/route")

function req(url: string, body: unknown, role: string): NextRequest {
  return new NextRequest(new URL(url), {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": "7", "x-user-role": role },
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
    headers: { "content-type": "application/json", "x-user-id": "7", "x-user-role": role },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

const validSettingsBody = {
  bolusInsulinBrand: "humalog",
  insulinActionDuration: 4,
  deliveryMethod: "pump",
}
// Jeux GROUPÉS valides (couverture 24 h no-gap/no-overlap) — le serveur re-valide (service mocké ici).
const validIsfSet = { slots: [{ startHour: 0, endHour: 0, sensitivityFactorGl: 0.5 }] }
const validIcrSet = { slots: [{ startHour: 0, endHour: 0, gramsPerUnit: 10 }] }
const validBasalSet = { slots: [{ startTime: "00:00", endTime: "00:00", rate: 0.95 }] }

describe("US-2657 grouped-only — insulin-therapy write routes RBAC (DOCTOR only)", () => {
  describe("PUT /api/insulin-therapy/settings", () => {
    it("REJECTS VIEWER (patient) with 403", async () => {
      expect((await settingsPut(req("http://localhost/api/insulin-therapy/settings", validSettingsBody, "VIEWER"))).status).toBe(403)
    })
    it("REJECTS NURSE with 403 (US-2648a — proposition, pas écriture directe)", async () => {
      expect((await settingsPut(req("http://localhost/api/insulin-therapy/settings", validSettingsBody, "NURSE"))).status).toBe(403)
    })
    it("accepts DOCTOR", async () => {
      expect((await settingsPut(req("http://localhost/api/insulin-therapy/settings", validSettingsBody, "DOCTOR"))).status).toBe(200)
    })
  })

  describe("PUT /api/insulin-therapy/sensitivity-factors (remplacement groupé ISF)", () => {
    const url = "http://localhost/api/insulin-therapy/sensitivity-factors"
    it("REJECTS VIEWER (patient) with 403 — must not self-mutate ISF", async () => {
      expect((await isfPut(reqMethod(url, "PUT", "VIEWER", validIsfSet))).status).toBe(403)
    })
    it("REJECTS NURSE with 403 (US-2648a)", async () => {
      expect((await isfPut(reqMethod(url, "PUT", "NURSE", validIsfSet))).status).toBe(403)
    })
    it("accepts DOCTOR", async () => {
      expect((await isfPut(reqMethod(url, "PUT", "DOCTOR", validIsfSet))).status).toBe(200)
    })
  })

  describe("PUT /api/insulin-therapy/carb-ratios (remplacement groupé ICR)", () => {
    const url = "http://localhost/api/insulin-therapy/carb-ratios"
    it("REJECTS VIEWER (patient) with 403 — must not self-mutate ICR", async () => {
      expect((await icrPut(reqMethod(url, "PUT", "VIEWER", validIcrSet))).status).toBe(403)
    })
    it("REJECTS NURSE with 403 (US-2648a)", async () => {
      expect((await icrPut(reqMethod(url, "PUT", "NURSE", validIcrSet))).status).toBe(403)
    })
    it("accepts DOCTOR", async () => {
      expect((await icrPut(reqMethod(url, "PUT", "DOCTOR", validIcrSet))).status).toBe(200)
    })
  })

  describe("PUT /api/insulin-therapy/basal-config/pump-slots (remplacement groupé basal)", () => {
    const url = "http://localhost/api/insulin-therapy/basal-config/pump-slots"
    it("REJECTS VIEWER with 403", async () => {
      expect((await pumpSlotPut(reqMethod(url, "PUT", "VIEWER", validBasalSet))).status).toBe(403)
    })
    it("REJECTS NURSE with 403 (US-2648a)", async () => {
      expect((await pumpSlotPut(reqMethod(url, "PUT", "NURSE", validBasalSet))).status).toBe(403)
    })
    it("accepts DOCTOR avec débit sur incrément (0.95)", async () => {
      expect((await pumpSlotPut(reqMethod(url, "PUT", "DOCTOR", validBasalSet))).status).toBe(200)
    })
    it("rejette un débit hors incrément pompe (0.37) → 400 (non délivrable, Zod)", async () => {
      const res = await pumpSlotPut(reqMethod(url, "PUT", "DOCTOR", { slots: [{ startTime: "00:00", endTime: "00:00", rate: 0.37 }] }))
      expect(res.status).toBe(400)
    })
  })

  describe("DELETE /api/insulin-therapy/settings (DOCTOR only)", () => {
    const url = "http://localhost/api/insulin-therapy/settings?patientId=42"
    it("REJECTS NURSE with 403", async () => {
      expect((await settingsDelete(reqMethod(url, "DELETE", "NURSE"))).status).toBe(403)
    })
    it("REJECTS VIEWER with 403", async () => {
      expect((await settingsDelete(reqMethod(url, "DELETE", "VIEWER"))).status).toBe(403)
    })
    it("accepts DOCTOR", async () => {
      expect((await settingsDelete(reqMethod(url, "DELETE", "DOCTOR"))).status).toBe(200)
    })
  })

  // ─────────────────────────────────────────────────────────────────────
  // Contract test: VIEWER (the patient) IS allowed to call /calculate-bolus.
  // Documents the ADR #13 carve-out (read-model simulation, never auto-injected).
  // ─────────────────────────────────────────────────────────────────────
  describe("POST /api/insulin-therapy/calculate-bolus (VIEWER allowed by design)", () => {
    const validBolusBody = { currentGlucoseGl: 1.5, carbsGrams: 60 }
    it("ALLOWS VIEWER (the patient) — documented ADR #13 carve-out", async () => {
      const res = await bolusPost(req("http://localhost/api/insulin-therapy/calculate-bolus", validBolusBody, "VIEWER"))
      expect(res.status).not.toBe(403)
      expect([200, 201]).toContain(res.status)
    })
  })
})
