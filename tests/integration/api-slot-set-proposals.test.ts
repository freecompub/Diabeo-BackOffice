/**
 * US-2657 (slice C3d) — Routes de REVUE médecin des propositions d'ENSEMBLE de créneaux (`SlotSetProposal`).
 * Sécurité : accept/reject = DOCTOR only (hiérarchique) + `canAccessPatient` (403 audité `accessDenied`),
 * lookup → 404 si absente/non pending (anti-IDOR neutre) ; list = `resolvePatientId` + consentement RGPD ;
 * rate-limit (429) sur les 3 routes. Mapping COMPLET des codes du service accept → 4xx (jamais 500) ;
 * notification patient après accept/reject réussi. Services mockés.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/db/client", () => ({ prisma: { slotSetProposal: { findUnique: vi.fn() } } }))
vi.mock("@/lib/gdpr", () => ({ requireGdprConsent: vi.fn().mockResolvedValue(true) }))
vi.mock("@/lib/access-control", () => ({ canAccessPatient: vi.fn(), resolvePatientId: vi.fn() }))
vi.mock("@/lib/auth/api-rate-limit", () => ({
  checkApiRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 29, retryAfterSec: 60 }),
  RATE_LIMITS: { insulinReview: { bucket: "insulin-review", windowSec: 60, max: 30, failMode: "open" } },
}))
vi.mock("@/lib/services/slot-set-proposal.service", () => ({
  slotSetProposalService: {
    acceptSetProposal: vi.fn(),
    rejectSetProposal: vi.fn(),
    listSetProposals: vi.fn(),
  },
}))
vi.mock("@/lib/services/adjustment.service", () => ({
  adjustmentService: { notifyPatient: vi.fn().mockResolvedValue({ notified: true }) },
}))
vi.mock("@/lib/services/audit.service", () => ({
  extractRequestContext: vi.fn().mockReturnValue({ ipAddress: "127.0.0.1", userAgent: "test", requestId: "r1" }),
  auditService: {
    accessDenied: vi.fn().mockResolvedValue({}),
    rateLimited: vi.fn().mockResolvedValue({}),
  },
}))

const { PATCH: ACCEPT } = await import("@/app/api/slot-set-proposals/[id]/accept/route")
const { PATCH: REJECT } = await import("@/app/api/slot-set-proposals/[id]/reject/route")
const { GET: LIST } = await import("@/app/api/slot-set-proposals/route")
const { prisma } = await import("@/lib/db/client")
const { canAccessPatient, resolvePatientId } = await import("@/lib/access-control")
const { checkApiRateLimit } = await import("@/lib/auth/api-rate-limit")
const { requireGdprConsent } = await import("@/lib/gdpr")
const { slotSetProposalService } = await import("@/lib/services/slot-set-proposal.service")
const { adjustmentService } = await import("@/lib/services/adjustment.service")
const { auditService } = await import("@/lib/services/audit.service")

const findUnique = vi.mocked(prisma.slotSetProposal.findUnique)
const access = vi.mocked(canAccessPatient)
const resolvePid = vi.mocked(resolvePatientId)
const rateLimit = vi.mocked(checkApiRateLimit)
const accept = vi.mocked(slotSetProposalService.acceptSetProposal)
const reject = vi.mocked(slotSetProposalService.rejectSetProposal)
const list = vi.mocked(slotSetProposalService.listSetProposals)
const notify = vi.mocked(adjustmentService.notifyPatient)

const params = (id: string) => ({ params: Promise.resolve({ id }) })
function patchReq(role: string | null): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (role !== null) {
    headers["x-user-id"] = "5"
    headers["x-user-role"] = role
  }
  return new NextRequest(new URL("http://localhost/api/slot-set-proposals/p1/accept"), { method: "PATCH", headers })
}
function getReq(role: string, qs = "?patientId=7"): NextRequest {
  return new NextRequest(new URL(`http://localhost/api/slot-set-proposals${qs}`), {
    method: "GET",
    headers: { "x-user-id": "5", "x-user-role": role },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  rateLimit.mockResolvedValue({ allowed: true, remaining: 29, retryAfterSec: 60 } as never)
  notify.mockResolvedValue({ notified: true } as never)
})

describe("PATCH /api/slot-set-proposals/:id/accept (C3d)", () => {
  beforeEach(() => {
    findUnique.mockResolvedValue({ patientId: 7, status: "pending" } as never)
    access.mockResolvedValue(true)
    accept.mockResolvedValue({ id: "p1", status: "accepted" } as never)
  })

  it("DOCTOR + accès → 200, service scopé (id, patientId, acteur) + patient notifié", async () => {
    const res = await ACCEPT(patchReq("DOCTOR"), params("p1"))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: "p1", status: "accepted", notified: true })
    expect(accept).toHaveBeenCalledWith("p1", 7, 5, expect.anything())
    expect(notify).toHaveBeenCalledWith(7, 5, "accepted", expect.anything())
  })

  it("non authentifié (pas de headers user) → 401 (AuthError), service NON appelé", async () => {
    const res = await ACCEPT(patchReq(null), params("p1"))
    expect(res.status).toBe(401)
    expect(accept).not.toHaveBeenCalled()
  })

  it("rôle < DOCTOR (NURSE) → 403, service NON appelé", async () => {
    const res = await ACCEPT(patchReq("NURSE"), params("p1"))
    expect(res.status).toBe(403)
    expect(accept).not.toHaveBeenCalled()
  })

  it("rate-limit dépassé → 429 + Retry-After + audit, service NON appelé", async () => {
    rateLimit.mockResolvedValue({ allowed: false, remaining: 0, retryAfterSec: 42 } as never)
    const res = await ACCEPT(patchReq("DOCTOR"), params("p1"))
    expect(res.status).toBe(429)
    expect(res.headers.get("Retry-After")).toBe("42")
    expect(accept).not.toHaveBeenCalled()
    expect(auditService.rateLimited).toHaveBeenCalled()
  })

  it("proposition absente → 404, service NON appelé (anti-IDOR)", async () => {
    findUnique.mockResolvedValue(null as never)
    const res = await ACCEPT(patchReq("DOCTOR"), params("p1"))
    expect(res.status).toBe(404)
    expect(accept).not.toHaveBeenCalled()
  })

  it("proposition non pending (déjà accepted) → 404", async () => {
    findUnique.mockResolvedValue({ patientId: 7, status: "accepted" } as never)
    expect((await ACCEPT(patchReq("DOCTOR"), params("p1"))).status).toBe(404)
  })

  it("hors portefeuille (canAccessPatient false) → 403 + audit accessDenied, service NON appelé", async () => {
    access.mockResolvedValue(false)
    const res = await ACCEPT(patchReq("DOCTOR"), params("p1"))
    expect(res.status).toBe(403)
    expect(accept).not.toHaveBeenCalled()
    expect(auditService.accessDenied).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 5, resource: "SLOT_SET_PROPOSAL", metadata: expect.objectContaining({ patientId: 7 }) }),
    )
  })

  it("course rejet/supersede (slotSetProposalNotFound levé) → 404, pas de notif", async () => {
    accept.mockRejectedValue(new Error("slotSetProposalNotFound"))
    expect((await ACCEPT(patchReq("DOCTOR"), params("p1"))).status).toBe(404)
    expect(notify).not.toHaveBeenCalled()
  })

  // Contrat C3d : AUCUN throw du service ne doit devenir un 500 → couverture complète de ACCEPT_ERROR_STATUS.
  it.each([
    ["valueOutOfBounds", 400],
    ["unsupportedSlotSetParam", 400],
    ["invalidSlotSet", 400],
    ["zeroDurationSlot", 400],
    ["slotGap", 422],
    ["slotOverlap", 409],
    ["emptySlotSet", 409],
    ["slotsBusy", 409],
    ["nonInsulinNoDose", 409],
    ["settingsNotFound", 404],
  ])("code service %s → %d (jamais 500)", async (code, status) => {
    accept.mockRejectedValue(new Error(code))
    expect((await ACCEPT(patchReq("DOCTOR"), params("p1"))).status).toBe(status)
  })

  it("erreur inattendue (non mappée) → 500 générique sans fuite", async () => {
    accept.mockRejectedValue(new Error("boom-internal"))
    const res = await ACCEPT(patchReq("DOCTOR"), params("p1"))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: "serverError" })
  })
})

describe("PATCH /api/slot-set-proposals/:id/reject (C3d)", () => {
  beforeEach(() => {
    findUnique.mockResolvedValue({ patientId: 7, status: "pending" } as never)
    access.mockResolvedValue(true)
    reject.mockResolvedValue({ id: "p1", status: "rejected" } as never)
  })

  it("DOCTOR + accès → 200, service scopé + patient notifié", async () => {
    const res = await REJECT(patchReq("DOCTOR"), params("p1"))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: "p1", status: "rejected", notified: true })
    expect(reject).toHaveBeenCalledWith("p1", 7, 5, expect.anything())
    expect(notify).toHaveBeenCalledWith(7, 5, "rejected", expect.anything())
  })

  it("rôle < DOCTOR → 403, service NON appelé", async () => {
    const res = await REJECT(patchReq("NURSE"), params("p1"))
    expect(res.status).toBe(403)
    expect(reject).not.toHaveBeenCalled()
  })

  it("rate-limit dépassé → 429", async () => {
    rateLimit.mockResolvedValue({ allowed: false, remaining: 0, retryAfterSec: 30 } as never)
    expect((await REJECT(patchReq("DOCTOR"), params("p1"))).status).toBe(429)
    expect(reject).not.toHaveBeenCalled()
  })

  it("proposition absente → 404", async () => {
    findUnique.mockResolvedValue(null as never)
    expect((await REJECT(patchReq("DOCTOR"), params("p1"))).status).toBe(404)
  })

  it("proposition non pending (rejected) → 404", async () => {
    findUnique.mockResolvedValue({ patientId: 7, status: "rejected" } as never)
    expect((await REJECT(patchReq("DOCTOR"), params("p1"))).status).toBe(404)
  })

  it("hors portefeuille → 403 + audit accessDenied", async () => {
    access.mockResolvedValue(false)
    expect((await REJECT(patchReq("DOCTOR"), params("p1"))).status).toBe(403)
    expect(auditService.accessDenied).toHaveBeenCalled()
  })

  it("course concurrente (slotSetProposalNotFound levé) → 404", async () => {
    reject.mockRejectedValue(new Error("slotSetProposalNotFound"))
    expect((await REJECT(patchReq("DOCTOR"), params("p1"))).status).toBe(404)
  })

  it("erreur inattendue → 500 générique", async () => {
    reject.mockRejectedValue(new Error("boom"))
    const res = await REJECT(patchReq("DOCTOR"), params("p1"))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: "serverError" })
  })
})

describe("GET /api/slot-set-proposals (C3d, liste)", () => {
  beforeEach(() => {
    vi.mocked(requireGdprConsent).mockResolvedValue(true)
    resolvePid.mockResolvedValue(7)
    list.mockResolvedValue([{ id: "p1", status: "pending" }] as never)
  })

  it("DOCTOR + patientId accessible → 200 + liste, service scopé", async () => {
    const res = await LIST(getReq("DOCTOR"))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ id: "p1", status: "pending" }])
    expect(list).toHaveBeenCalledWith(7, 5, undefined, expect.anything())
  })

  it("VIEWER (own record) → 200, resolvePatientId ignore le param", async () => {
    resolvePid.mockResolvedValue(9)
    const res = await LIST(getReq("VIEWER", ""))
    expect(res.status).toBe(200)
    expect(list).toHaveBeenCalledWith(9, 5, undefined, expect.anything())
  })

  it("filtre status=pending propagé au service", async () => {
    await LIST(getReq("DOCTOR", "?patientId=7&status=pending"))
    expect(list).toHaveBeenCalledWith(7, 5, "pending", expect.anything())
  })

  it("rate-limit dépassé → 429, service NON appelé", async () => {
    rateLimit.mockResolvedValue({ allowed: false, remaining: 0, retryAfterSec: 15 } as never)
    expect((await LIST(getReq("DOCTOR"))).status).toBe(429)
    expect(list).not.toHaveBeenCalled()
  })

  it("consentement RGPD absent → 403, service NON appelé", async () => {
    vi.mocked(requireGdprConsent).mockResolvedValueOnce(false)
    const res = await LIST(getReq("DOCTOR"))
    expect(res.status).toBe(403)
    expect(list).not.toHaveBeenCalled()
  })

  it("pro fournit un patientId hors périmètre → 404 + audit accessDenied (sonde), service NON appelé", async () => {
    resolvePid.mockResolvedValue(null)
    const res = await LIST(getReq("DOCTOR", "?patientId=999"))
    expect(res.status).toBe(404)
    expect(list).not.toHaveBeenCalled()
    expect(auditService.accessDenied).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 5, metadata: expect.objectContaining({ patientId: 999 }) }),
    )
  })

  it("patient non résolu SANS param (pas une sonde) → 404, PAS d'audit accessDenied", async () => {
    resolvePid.mockResolvedValue(null)
    const res = await LIST(getReq("DOCTOR", ""))
    expect(res.status).toBe(404)
    expect(auditService.accessDenied).not.toHaveBeenCalled()
  })

  it("status invalide → 400", async () => {
    expect((await LIST(getReq("DOCTOR", "?patientId=7&status=bogus"))).status).toBe(400)
  })
})
