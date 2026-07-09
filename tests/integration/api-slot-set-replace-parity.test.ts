/**
 * US-2657 (grouped-only) — Test de PARITÉ des 3 routes de remplacement GROUPÉ (ISF / ICR / basal).
 *
 * Verrou anti-dérive (revue #710) : depuis la factorisation via `handleSlotSetReplace`, les trois `PUT`
 * partagent le MÊME cœur (auth DOCTOR, consentement RGPD, résolution patient anti-IDOR, mapping erreurs→HTTP).
 * Ce test le garantit route par route — si une route diverge (garde retirée, mapping oublié), il casse.
 * Seul le service de persistance diffère (`replaceSlotSet` ISF/ICR vs `replacePumpSlotSet` basal) : mocké.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/db/client", () => ({ prisma: {} }))
vi.mock("@/lib/gdpr", () => ({ requireGdprConsent: vi.fn().mockResolvedValue(true) }))
vi.mock("@/lib/access-control", () => ({ resolvePatientId: vi.fn().mockResolvedValue(42) }))
vi.mock("@/lib/services/audit.service", () => ({
  extractRequestContext: () => ({ ipAddress: "1.2.3.4", userAgent: "vitest", requestId: "r" }),
}))
vi.mock("@/lib/services/insulin-therapy.service", () => ({
  insulinTherapyService: {
    replaceSlotSet: vi.fn().mockResolvedValue({ applied: true }),
    replacePumpSlotSet: vi.fn().mockResolvedValue({ applied: true }),
  },
  INSULIN_BOUNDS: { ISF_GL_MIN: 0.1, ISF_GL_MAX: 1.0, ICR_MIN: 3, ICR_MAX: 30, BASAL_MIN: 0.05, BASAL_MAX: 5.0, PUMP_BASAL_INCREMENT: 0.05 },
}))

const { PUT: isfPut } = await import("@/app/api/insulin-therapy/sensitivity-factors/route")
const { PUT: icrPut } = await import("@/app/api/insulin-therapy/carb-ratios/route")
const { PUT: basalPut } = await import("@/app/api/insulin-therapy/basal-config/pump-slots/route")
const { resolvePatientId } = await import("@/lib/access-control")
const { requireGdprConsent } = await import("@/lib/gdpr")
const { insulinTherapyService } = await import("@/lib/services/insulin-therapy.service")

const resolvePid = vi.mocked(resolvePatientId)
const consent = vi.mocked(requireGdprConsent)
const svc = insulinTherapyService as unknown as {
  replaceSlotSet: ReturnType<typeof vi.fn>
  replacePumpSlotSet: ReturnType<typeof vi.fn>
}

function put(url: string, role: string, body: unknown): NextRequest {
  return new NextRequest(new URL(url), {
    method: "PUT",
    headers: { "content-type": "application/json", "x-user-id": "7", "x-user-role": role },
    body: JSON.stringify(body),
  })
}

// Jeux valides (couverture 24 h via créneau enjambant minuit — endHour/endTime = minuit).
const ROUTES = [
  {
    name: "sensitivity-factors (ISF)",
    handler: isfPut,
    url: "http://localhost/api/insulin-therapy/sensitivity-factors",
    body: { slots: [{ startHour: 0, endHour: 12, sensitivityFactorGl: 0.5 }, { startHour: 12, endHour: 0, sensitivityFactorGl: 0.6 }] },
    service: "replaceSlotSet" as const,
  },
  {
    name: "carb-ratios (ICR)",
    handler: icrPut,
    url: "http://localhost/api/insulin-therapy/carb-ratios",
    body: { slots: [{ startHour: 0, endHour: 12, gramsPerUnit: 10 }, { startHour: 12, endHour: 0, gramsPerUnit: 12 }] },
    service: "replaceSlotSet" as const,
  },
  {
    name: "basal-config/pump-slots (basal)",
    handler: basalPut,
    url: "http://localhost/api/insulin-therapy/basal-config/pump-slots",
    body: { slots: [{ startTime: "00:00", endTime: "12:00", rate: 0.9 }, { startTime: "12:00", endTime: "00:00", rate: 0.75 }] },
    service: "replacePumpSlotSet" as const,
  },
]

describe("Parité des routes de remplacement groupé (US-2657 grouped-only)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolvePid.mockResolvedValue(42)
    consent.mockResolvedValue(true)
    svc.replaceSlotSet.mockResolvedValue({ applied: true })
    svc.replacePumpSlotSet.mockResolvedValue({ applied: true })
  })

  for (const r of ROUTES) {
    describe(r.name, () => {
      it("DOCTOR + jeu valide → 200, service de persistance appelé", async () => {
        const res = await r.handler(put(r.url, "DOCTOR", r.body))
        expect(res.status).toBe(200)
        expect(svc[r.service]).toHaveBeenCalled()
      })

      it("VIEWER (patient) → 403 (DOCTOR only), service NON appelé", async () => {
        const res = await r.handler(put(r.url, "VIEWER", r.body))
        expect(res.status).toBe(403)
        expect(svc[r.service]).not.toHaveBeenCalled()
      })

      it("NURSE → 403 (écriture directe DOCTOR only)", async () => {
        expect((await r.handler(put(r.url, "NURSE", r.body))).status).toBe(403)
      })

      it("consentement RGPD absent → 403, service NON appelé", async () => {
        consent.mockResolvedValueOnce(false)
        const res = await r.handler(put(r.url, "DOCTOR", r.body))
        expect(res.status).toBe(403)
        expect(svc[r.service]).not.toHaveBeenCalled()
      })

      it("patient non résolu (anti-IDOR) → 404, service NON appelé", async () => {
        resolvePid.mockResolvedValueOnce(null)
        const res = await r.handler(put(r.url, "DOCTOR", r.body))
        expect(res.status).toBe(404)
        expect(svc[r.service]).not.toHaveBeenCalled()
      })

      it("erreur métier connue (slotsBusy) → 409 (mappée via SLOT_SET_ERROR_STATUS)", async () => {
        svc[r.service].mockRejectedValueOnce(new Error("slotsBusy"))
        expect((await r.handler(put(r.url, "DOCTOR", r.body))).status).toBe(409)
      })

      it("erreur inattendue (non mappée) → 500 générique sans fuite", async () => {
        svc[r.service].mockRejectedValueOnce(new Error("boom-internal"))
        const res = await r.handler(put(r.url, "DOCTOR", r.body))
        expect(res.status).toBe(500)
        expect(await res.json()).toEqual({ error: "serverError" })
      })

      it("corps invalide (Zod) → 400", async () => {
        expect((await r.handler(put(r.url, "DOCTOR", { slots: [] }))).status).toBe(400)
      })
    })
  }
})
