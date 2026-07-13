/**
 * US-2657 — Route self-service patient `PUT /api/patient/insulin-slot-set`.
 * Comportement : une soumission patient est **TOUJOURS** une proposition d'ensemble (`createSetProposal`) —
 * plus d'auto-application. Sécurité : own-id STRICT (`getOwnPatientId`, anti-IDOR → 404 neutre pour un pro
 * sans dossier), rate-limit, consentement RGPD, validation Zod (ISF/ICR seulement, ≤24 créneaux) ; mapping
 * des rejets durs / doublon pending / verrou → 4xx + audit `INSULIN_SLOT_SUBMISSION`. Service mocké.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/db/client", () => ({ prisma: {} }))
vi.mock("@/lib/gdpr", () => ({ requireGdprConsent: vi.fn().mockResolvedValue(true) }))
vi.mock("@/lib/access-control", () => ({ getOwnPatientId: vi.fn() }))
vi.mock("@/lib/auth/api-rate-limit", () => ({
  checkApiRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 19, retryAfterSec: 60 }),
  RATE_LIMITS: { insulinSubmission: { bucket: "insulin-submission", windowSec: 60, max: 20, failMode: "open" } },
}))
vi.mock("@/lib/services/slot-set-proposal.service", () => ({ slotSetProposalService: { createSetProposal: vi.fn() } }))
vi.mock("@/lib/services/audit.service", () => ({
  extractRequestContext: vi.fn().mockReturnValue({ ipAddress: "127.0.0.1", userAgent: "test", requestId: "r1" }),
  auditService: { log: vi.fn().mockResolvedValue(undefined), rateLimited: vi.fn().mockResolvedValue({}) },
}))

const { PUT } = await import("@/app/api/patient/insulin-slot-set/route")
const { getOwnPatientId } = await import("@/lib/access-control")
const { requireGdprConsent } = await import("@/lib/gdpr")
const { checkApiRateLimit } = await import("@/lib/auth/api-rate-limit")
const { slotSetProposalService } = await import("@/lib/services/slot-set-proposal.service")
const { auditService } = await import("@/lib/services/audit.service")

const ownPatient = vi.mocked(getOwnPatientId)
const createProposal = vi.mocked(slotSetProposalService.createSetProposal)
const rateLimit = vi.mocked(checkApiRateLimit)

const SLOTS = [
  { startHour: 0, endHour: 8, value: 0.5 },
  { startHour: 8, endHour: 22, value: 0.45 },
  { startHour: 22, endHour: 0, value: 0.4 },
]
function req(role: string, body: unknown): NextRequest {
  return new NextRequest(new URL("http://localhost/api/patient/insulin-slot-set"), {
    method: "PUT",
    headers: { "content-type": "application/json", "x-user-id": "42", "x-user-role": role },
    body: JSON.stringify(body),
  })
}
const isf = (slots: unknown = SLOTS) => req("VIEWER", { parameterType: "insulinSensitivityFactor", slots })

describe("PUT /api/patient/insulin-slot-set (toujours proposition)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ownPatient.mockResolvedValue(7)
    rateLimit.mockResolvedValue({ allowed: true, remaining: 19, retryAfterSec: 60 } as never)
    createProposal.mockResolvedValue({ id: "set-1" } as never)
  })

  it("patient soumet → 201 proposition + service appelé avec patientId scopé (own-id) + acteur = user", async () => {
    const res = await PUT(isf())
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ outcome: "proposal", proposalId: "set-1" })
    // US-2663 (S0) — provenance bundlée `{ userId, source }` dérivée SESSION ; voie patient-only → source=patient.
    expect(createProposal).toHaveBeenCalledWith(expect.objectContaining({ patientId: 7, parameterType: "insulinSensitivityFactor", proposedSlots: SLOTS, proposer: { userId: 42, source: "patient" } }))
  })

  it("US-2663 (S0) — un `source` fourni dans le body est IGNORÉ (anti-usurpation) → source=patient dérivé session", async () => {
    // Le `bodySchema` ne déclare pas `source` → Zod strippe la clé hostile ; la provenance vient de la session.
    const res = await PUT(req("VIEWER", { parameterType: "insulinSensitivityFactor", slots: SLOTS, source: "doctor" }))
    expect(res.status).toBe(201)
    expect(createProposal).toHaveBeenCalledWith(expect.objectContaining({ patientId: 7, parameterType: "insulinSensitivityFactor", proposedSlots: SLOTS, proposer: { userId: 42, source: "patient" } }))
  })

  it("pas de dossier patient (pro) → 404 neutre, service NON appelé (anti-IDOR)", async () => {
    ownPatient.mockResolvedValue(null)
    const res = await PUT(req("DOCTOR", { parameterType: "insulinSensitivityFactor", slots: SLOTS }))
    expect(res.status).toBe(404)
    expect(createProposal).not.toHaveBeenCalled()
  })

  it("paramètre non ISF/ICR (basalRate) → 400", async () => {
    expect((await PUT(req("VIEWER", { parameterType: "basalRate", slots: SLOTS }))).status).toBe(400)
    expect(createProposal).not.toHaveBeenCalled()
  })

  it("payload > 24 créneaux → 400 (borne anti-abus)", async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ startHour: i % 24, endHour: (i + 1) % 24, value: 0.5 }))
    expect((await PUT(isf(many))).status).toBe(400)
  })

  it("rejet dur bornes (valueOutOfBounds) → 400 + audit tentative", async () => {
    createProposal.mockRejectedValue(new Error("valueOutOfBounds"))
    expect((await PUT(isf())).status).toBe(400)
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: "INSULIN_SLOT_SUBMISSION", metadata: expect.objectContaining({ outcome: "rejected", reason: "valueOutOfBounds" }) }),
    )
  })

  it("double-soumission concurrente (duplicatePendingProposal) → 409 (pas 500)", async () => {
    createProposal.mockRejectedValue(new Error("duplicatePendingProposal"))
    expect((await PUT(isf())).status).toBe(409)
  })

  it("patient non insuliné (nonInsulinNoDose, frontière MDR) → 409 (pas 500)", async () => {
    createProposal.mockRejectedValue(new Error("nonInsulinNoDose"))
    expect((await PUT(isf())).status).toBe(409)
  })

  it("patientNotFound (soft-deleted en course) → 404 (pas 500)", async () => {
    createProposal.mockRejectedValue(new Error("patientNotFound"))
    expect((await PUT(isf())).status).toBe(404)
  })

  it("erreur inattendue (non mappée) → 500 générique sans fuite", async () => {
    createProposal.mockRejectedValue(new Error("boom-internal"))
    const res = await PUT(isf())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: "serverError" })
  })

  it("rate-limit dépassé → 429 + audit rateLimited (service non appelé)", async () => {
    rateLimit.mockResolvedValue({ allowed: false, remaining: 0, retryAfterSec: 42 } as never)
    const res = await PUT(isf())
    expect(res.status).toBe(429)
    expect(res.headers.get("Retry-After")).toBe("42")
    expect(createProposal).not.toHaveBeenCalled()
    expect(auditService.rateLimited).toHaveBeenCalled()
  })

  it("consentement RGPD absent → 403 (service non appelé)", async () => {
    vi.mocked(requireGdprConsent).mockResolvedValueOnce(false)
    const res = await PUT(isf())
    expect(res.status).toBe(403)
    expect(createProposal).not.toHaveBeenCalled()
  })
})
