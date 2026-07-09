/**
 * US-2657 (slice C3d) — Routes de REVUE médecin des propositions d'ENSEMBLE de créneaux (`SlotSetProposal`).
 * Sécurité : accept/reject = DOCTOR only (hiérarchique) + `canAccessPatient` (403 hors portefeuille), lookup
 * → 404 si absente/non pending (anti-IDOR neutre) ; list = `resolvePatientId` + consentement RGPD.
 * Mapping des rejets cliniques/verrou de l'`acceptSetProposal` → 4xx (slotSetProposalNotFound 404,
 * valueOutOfBounds 400, slotsBusy 409) ; inattendu → 500 générique. Service mocké.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/db/client", () => ({ prisma: { slotSetProposal: { findUnique: vi.fn() } } }))
vi.mock("@/lib/gdpr", () => ({ requireGdprConsent: vi.fn().mockResolvedValue(true) }))
vi.mock("@/lib/access-control", () => ({ canAccessPatient: vi.fn(), resolvePatientId: vi.fn() }))
vi.mock("@/lib/services/slot-set-proposal.service", () => ({
  slotSetProposalService: {
    acceptSetProposal: vi.fn(),
    rejectSetProposal: vi.fn(),
    listSetProposals: vi.fn(),
  },
}))
vi.mock("@/lib/services/audit.service", () => ({
  extractRequestContext: vi.fn().mockReturnValue({ ipAddress: "127.0.0.1", userAgent: "test", requestId: "r1" }),
}))

const { PATCH: ACCEPT } = await import("@/app/api/slot-set-proposals/[id]/accept/route")
const { PATCH: REJECT } = await import("@/app/api/slot-set-proposals/[id]/reject/route")
const { GET: LIST } = await import("@/app/api/slot-set-proposals/route")
const { prisma } = await import("@/lib/db/client")
const { canAccessPatient, resolvePatientId } = await import("@/lib/access-control")
const { requireGdprConsent } = await import("@/lib/gdpr")
const { slotSetProposalService } = await import("@/lib/services/slot-set-proposal.service")

const findUnique = vi.mocked(prisma.slotSetProposal.findUnique)
const access = vi.mocked(canAccessPatient)
const resolvePid = vi.mocked(resolvePatientId)
const accept = vi.mocked(slotSetProposalService.acceptSetProposal)
const reject = vi.mocked(slotSetProposalService.rejectSetProposal)
const list = vi.mocked(slotSetProposalService.listSetProposals)

const params = (id: string) => ({ params: Promise.resolve({ id }) })
function patchReq(role: string): NextRequest {
  return new NextRequest(new URL("http://localhost/api/slot-set-proposals/p1/accept"), {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-user-id": "5", "x-user-role": role },
  })
}
function getReq(role: string, qs = "?patientId=7"): NextRequest {
  return new NextRequest(new URL(`http://localhost/api/slot-set-proposals${qs}`), {
    method: "GET",
    headers: { "x-user-id": "5", "x-user-role": role },
  })
}

describe("PATCH /api/slot-set-proposals/:id/accept (C3d)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findUnique.mockResolvedValue({ patientId: 7, status: "pending" } as never)
    access.mockResolvedValue(true)
    accept.mockResolvedValue({ id: "p1", status: "accepted" } as never)
  })

  it("DOCTOR + accès → 200, service appelé avec (id, patientId scopé, acteur)", async () => {
    const res = await ACCEPT(patchReq("DOCTOR"), params("p1"))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: "p1", status: "accepted" })
    expect(accept).toHaveBeenCalledWith("p1", 7, 5, expect.anything())
  })

  it("rôle < DOCTOR (NURSE) → 403, service NON appelé", async () => {
    const res = await ACCEPT(patchReq("NURSE"), params("p1"))
    expect(res.status).toBe(403)
    expect(accept).not.toHaveBeenCalled()
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

  it("hors portefeuille (canAccessPatient false) → 403, service NON appelé", async () => {
    access.mockResolvedValue(false)
    const res = await ACCEPT(patchReq("DOCTOR"), params("p1"))
    expect(res.status).toBe(403)
    expect(accept).not.toHaveBeenCalled()
  })

  it("course rejet/supersede (slotSetProposalNotFound levé par le service) → 404", async () => {
    accept.mockRejectedValue(new Error("slotSetProposalNotFound"))
    expect((await ACCEPT(patchReq("DOCTOR"), params("p1"))).status).toBe(404)
  })

  it("rejet clinique (valueOutOfBounds) → 400", async () => {
    accept.mockRejectedValue(new Error("valueOutOfBounds"))
    expect((await ACCEPT(patchReq("DOCTOR"), params("p1"))).status).toBe(400)
  })

  it("verrou occupé (slotsBusy) → 409", async () => {
    accept.mockRejectedValue(new Error("slotsBusy"))
    expect((await ACCEPT(patchReq("DOCTOR"), params("p1"))).status).toBe(409)
  })

  it("erreur inattendue → 500 générique sans fuite", async () => {
    accept.mockRejectedValue(new Error("boom-internal"))
    const res = await ACCEPT(patchReq("DOCTOR"), params("p1"))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: "serverError" })
  })
})

describe("PATCH /api/slot-set-proposals/:id/reject (C3d)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findUnique.mockResolvedValue({ patientId: 7, status: "pending" } as never)
    access.mockResolvedValue(true)
    reject.mockResolvedValue({ id: "p1", status: "rejected" } as never)
  })

  it("DOCTOR + accès → 200, service appelé avec (id, patientId, acteur)", async () => {
    const res = await REJECT(patchReq("DOCTOR"), params("p1"))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: "p1", status: "rejected" })
    expect(reject).toHaveBeenCalledWith("p1", 7, 5, expect.anything())
  })

  it("rôle < DOCTOR → 403, service NON appelé", async () => {
    const res = await REJECT(patchReq("NURSE"), params("p1"))
    expect(res.status).toBe(403)
    expect(reject).not.toHaveBeenCalled()
  })

  it("proposition absente → 404", async () => {
    findUnique.mockResolvedValue(null as never)
    expect((await REJECT(patchReq("DOCTOR"), params("p1"))).status).toBe(404)
  })

  it("hors portefeuille → 403", async () => {
    access.mockResolvedValue(false)
    expect((await REJECT(patchReq("DOCTOR"), params("p1"))).status).toBe(403)
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
    vi.clearAllMocks()
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

  it("filtre status=pending propagé au service", async () => {
    await LIST(getReq("DOCTOR", "?patientId=7&status=pending"))
    expect(list).toHaveBeenCalledWith(7, 5, "pending", expect.anything())
  })

  it("consentement RGPD absent → 403, service NON appelé", async () => {
    vi.mocked(requireGdprConsent).mockResolvedValueOnce(false)
    const res = await LIST(getReq("DOCTOR"))
    expect(res.status).toBe(403)
    expect(list).not.toHaveBeenCalled()
  })

  it("patient non résolu (pro sans accès / anti-IDOR) → 404, service NON appelé", async () => {
    resolvePid.mockResolvedValue(null)
    const res = await LIST(getReq("DOCTOR"))
    expect(res.status).toBe(404)
    expect(list).not.toHaveBeenCalled()
  })

  it("status invalide → 400", async () => {
    expect((await LIST(getReq("DOCTOR", "?patientId=7&status=bogus"))).status).toBe(400)
  })
})
