/**
 * US-2657 (slice C3c) — Route self-service patient `PUT /api/patient/insulin-slot-set`.
 * Sécurité : own-id STRICT (`getOwnPatientId`, anti-IDOR → 404 neutre pour un pro sans dossier),
 * consentement RGPD, validation Zod (ISF/ICR seulement) ; dispatch de l'`outcome` gouverné ; mapping des
 * rejets durs (bornes) / verrou occupé → 4xx. L'orchestrateur `applyExpertGroupGoverned` est mocké.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/db/client", () => ({ prisma: {} }))
vi.mock("@/lib/gdpr", () => ({ requireGdprConsent: vi.fn().mockResolvedValue(true) }))
// `resolvePatientId` requis par le module `slot-set-replace` (importé pour SLOT_SET_ERROR_STATUS).
vi.mock("@/lib/access-control", () => ({ getOwnPatientId: vi.fn(), resolvePatientId: vi.fn() }))
vi.mock("@/lib/services/auto-apply.service", () => ({ autoApplyService: { applyExpertGroupGoverned: vi.fn() } }))
vi.mock("@/lib/services/audit.service", () => ({
  extractRequestContext: vi.fn().mockReturnValue({ ipAddress: "127.0.0.1", userAgent: "test", requestId: "r1" }),
}))

const { PUT } = await import("@/app/api/patient/insulin-slot-set/route")
const { getOwnPatientId } = await import("@/lib/access-control")
const { requireGdprConsent } = await import("@/lib/gdpr")
const { autoApplyService } = await import("@/lib/services/auto-apply.service")

const ownPatient = vi.mocked(getOwnPatientId)
const govern = vi.mocked(autoApplyService.applyExpertGroupGoverned)

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

describe("PUT /api/patient/insulin-slot-set (C3c)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ownPatient.mockResolvedValue(7)
    govern.mockResolvedValue({ outcome: "proposal", failedCheck: "C1", proposalId: "set-1" } as never)
  })

  it("patient soumet → 200 + orchestrateur appelé avec patientId scopé (own-id) + acteur = user", async () => {
    const res = await PUT(req("VIEWER", { parameterType: "insulinSensitivityFactor", slots: SLOTS }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ outcome: "proposal", failedCheck: "C1", proposalId: "set-1" })
    expect(govern).toHaveBeenCalledWith(
      { patientId: 7, parameterType: "insulinSensitivityFactor", proposedSlots: SLOTS },
      42,
      expect.any(Date),
      expect.anything(),
    )
  })

  it("outcome applied → 200", async () => {
    govern.mockResolvedValue({ outcome: "applied" } as never)
    const res = await PUT(req("VIEWER", { parameterType: "insulinToCarbRatio", slots: SLOTS }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ outcome: "applied" })
  })

  it("pas de dossier patient (pro) → 404 neutre, orchestrateur NON appelé (anti-IDOR)", async () => {
    ownPatient.mockResolvedValue(null)
    const res = await PUT(req("DOCTOR", { parameterType: "insulinSensitivityFactor", slots: SLOTS }))
    expect(res.status).toBe(404)
    expect(govern).not.toHaveBeenCalled()
  })

  it("paramètre non ISF/ICR (basalRate) → 400", async () => {
    const res = await PUT(req("VIEWER", { parameterType: "basalRate", slots: SLOTS }))
    expect(res.status).toBe(400)
    expect(govern).not.toHaveBeenCalled()
  })

  it("rejet dur bornes (valueOutOfBounds) → 400", async () => {
    govern.mockRejectedValue(new Error("valueOutOfBounds"))
    expect((await PUT(req("VIEWER", { parameterType: "insulinSensitivityFactor", slots: SLOTS }))).status).toBe(400)
  })

  it("verrou occupé (slotsBusy) → 409", async () => {
    govern.mockRejectedValue(new Error("slotsBusy"))
    expect((await PUT(req("VIEWER", { parameterType: "insulinSensitivityFactor", slots: SLOTS }))).status).toBe(409)
  })

  it("consentement RGPD absent → 403 (orchestrateur non appelé)", async () => {
    vi.mocked(requireGdprConsent).mockResolvedValueOnce(false)
    const res = await PUT(req("VIEWER", { parameterType: "insulinSensitivityFactor", slots: SLOTS }))
    expect(res.status).toBe(403)
    expect(govern).not.toHaveBeenCalled()
  })
})
