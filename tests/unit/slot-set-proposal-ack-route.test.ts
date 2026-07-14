/**
 * US-2663 (S5/c4) — Route POST/PUT /api/team/slot-set-proposal-ack/[proposalId] :
 * frontière de provenance sur l'accusé/réponse patient d'une proposition GROUPÉE (SlotSetProposal).
 *
 * Risque clinique / sécurité testé : port grouped-only de US-2665. Un patient (VIEWER) connaissant
 * l'UUID d'une SlotSetProposal `nurse`/`doctor`/`algorithm` de SON dossier ne doit PAS pouvoir
 * l'acquitter ni y répondre (divulgation d'existence d'une décision de dose non validée — frontière
 * MDR, ADR #13). La frontière est IDENTIQUE à la lecture (`viewerProposalSources` → VIEWER =
 * ['patient']) et NON énumérante : 404 uniforme (tierce / autre dossier / inexistante), jamais 200,
 * jamais un 403 distinct de « inexistant ». Le 403 est réservé au cas « pas de dossier patient propre »
 * (pro/ADMIN), qui n'est pas une sonde de ressource tierce → non audité.
 *
 * Ne teste PAS iOS.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { NextRequest } from "next/server"

const { mocks } = vi.hoisted(() => ({
  mocks: {
    requireAuth: vi.fn(),
    getOwnPatientId: vi.fn(),
    findFirst: vi.fn(),
    markRead: vi.fn(),
    respond: vi.fn(),
    accessDenied: vi.fn(),
    // Revue PR #749 (findings #6/#7) — garde UUID + rate-limit anti-abus sur l'ack patient.
    checkApiRateLimit: vi.fn(),
    rateLimited: vi.fn(),
  },
}))

vi.mock("@/lib/auth", () => {
  class AuthError extends Error {
    status = 401
  }
  return { requireAuth: mocks.requireAuth, AuthError }
})
vi.mock("@/lib/auth/api-rate-limit", () => ({
  checkApiRateLimit: mocks.checkApiRateLimit,
  RATE_LIMITS: { insulinSubmission: {} },
}))
vi.mock("@/lib/access-control", () => ({
  getOwnPatientId: mocks.getOwnPatientId,
  // Helper pur (US-2664/2665) — reproduit le vrai comportement : VIEWER → ["patient"], pros → undefined.
  viewerProposalSources: (role: string) => (role === "VIEWER" ? ["patient"] : undefined),
}))
vi.mock("@/lib/db/client", () => ({
  prisma: { slotSetProposal: { findFirst: mocks.findFirst } },
}))
vi.mock("@/lib/services/team-workflow.service", () => ({
  slotSetProposalAckService: { markRead: mocks.markRead, respond: mocks.respond },
}))
vi.mock("@/lib/services/audit.service", () => ({
  extractRequestContext: () => ({ ipAddress: "1.1.1.1", userAgent: "test", requestId: "req-1" }),
  auditService: { accessDenied: mocks.accessDenied, rateLimited: mocks.rateLimited },
}))
vi.mock("@/lib/team-route-helpers", () => ({
  mapErrorToResponse: () => new Response(JSON.stringify({ error: "serverError" }), { status: 500 }),
}))

import { POST, PUT } from "@/app/api/team/slot-set-proposal-ack/[proposalId]/route"

const paramsFor = (proposalId: string) => ({ params: Promise.resolve({ proposalId }) })
const putReq = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest
const emptyReq = {} as unknown as NextRequest

// UUID valides (garde de format finding #6). La sémantique « propre » vs « tierce » se distingue par le
// retour de `findFirst` mocké (filtre de provenance serveur), PAS par l'id lui-même.
const ID_OWN = "11111111-1111-1111-1111-111111111111"
const ID_NURSE = "22222222-2222-2222-2222-222222222222"
const ID_DOCTOR = "33333333-3333-3333-3333-333333333333"
const ID_MISSING = "44444444-4444-4444-4444-444444444444"

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset())
  mocks.requireAuth.mockReturnValue({ id: 20, role: "VIEWER" })
  mocks.getOwnPatientId.mockResolvedValue(5)
  mocks.markRead.mockResolvedValue({ id: "ack1", readAt: new Date("2026-07-14T00:00:00Z") })
  mocks.respond.mockResolvedValue({ id: "ack1", accepted: true, respondedAt: new Date("2026-07-14T00:00:00Z") })
  mocks.accessDenied.mockResolvedValue({})
  // Par défaut, rate-limit non atteint → les tests existants passent la garde sans friction.
  mocks.checkApiRateLimit.mockResolvedValue({ allowed: true })
  mocks.rateLimited.mockResolvedValue({})
})

describe("provenance frontier on slot-set-proposal-ack (POST markRead)", () => {
  it("VIEWER acquitte SA propre proposition groupée (source=patient) → 200 + filtre de provenance imposé", async () => {
    mocks.findFirst.mockResolvedValue({ id: ID_OWN, patientId: 5 })
    const res = await POST(emptyReq, paramsFor(ID_OWN))
    expect(res.status).toBe(200)
    expect(mocks.markRead).toHaveBeenCalledWith(ID_OWN, 5, 20, expect.anything())
    // La requête d'ownership DOIT porter le filtre `source IN ['patient']` (imposé serveur, pas la query).
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: ID_OWN, patientId: 5, source: { in: ["patient"] } }),
      }),
    )
  })

  it("VIEWER acquitte une proposition TIERCE (nurse/doctor/algo) de son dossier → 404, jamais 200", async () => {
    // findFirst renvoie null : le filtre de provenance exclut la proposition non-patient.
    mocks.findFirst.mockResolvedValue(null)
    const res = await POST(emptyReq, paramsFor(ID_NURSE))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: "notFound" })
    expect(mocks.markRead).not.toHaveBeenCalled()
    // Finding HDS LOW — la sonde (404) est auditée pour le SOC (parité US-2665, model=slotSet).
    expect(mocks.accessDenied).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 20,
        resource: "PROPOSAL_ACK",
        resourceId: ID_NURSE,
        metadata: expect.objectContaining({
          patientId: 5,
          model: "slotSet",
          kind: "slotSetProposalAckDenied",
        }),
      }),
    )
  })

  it("VIEWER, UUID inexistant → 404 (réponse identique au cas tierce : non énumérant)", async () => {
    mocks.findFirst.mockResolvedValue(null)
    const res = await POST(emptyReq, paramsFor(ID_MISSING))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: "notFound" })
  })

  it("un pro (pas de dossier patient propre) → 403, sans filtre de provenance ni audit de sonde", async () => {
    mocks.requireAuth.mockReturnValue({ id: 99, role: "NURSE" })
    mocks.getOwnPatientId.mockResolvedValue(null)
    const res = await POST(emptyReq, paramsFor(ID_OWN))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: "forbidden" })
    expect(mocks.findFirst).not.toHaveBeenCalled()
    // 403 = condition self-referential sur le compte, PAS une sonde de ressource tierce → non audité.
    expect(mocks.accessDenied).not.toHaveBeenCalled()
  })

  it("finding #6 — UUID malformé → 400 invalidProposalId, sans lookup ni service", async () => {
    const res = await POST(emptyReq, paramsFor("pas-un-uuid"))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "invalidProposalId" })
    // La garde de format court-circuite AVANT toute résolution / rate-limit / service.
    expect(mocks.checkApiRateLimit).not.toHaveBeenCalled()
    expect(mocks.findFirst).not.toHaveBeenCalled()
    expect(mocks.markRead).not.toHaveBeenCalled()
  })

  it("finding #7 — rate-limit dépassé → 429 rateLimitExceeded (Retry-After) + audit rateLimited", async () => {
    mocks.checkApiRateLimit.mockResolvedValue({ allowed: false, retryAfterSec: 60 })
    const res = await POST(emptyReq, paramsFor(ID_OWN))
    expect(res.status).toBe(429)
    expect(res.headers.get("Retry-After")).toBe("60")
    expect(await res.json()).toEqual({ error: "rateLimitExceeded" })
    expect(mocks.rateLimited).toHaveBeenCalled()
    // Le débit bloqué court-circuite la résolution d'ownership et le service.
    expect(mocks.findFirst).not.toHaveBeenCalled()
    expect(mocks.markRead).not.toHaveBeenCalled()
  })
})

describe("provenance frontier on slot-set-proposal-ack (PUT respond)", () => {
  it("VIEWER répond à SA proposition groupée (source=patient) → 200 (accusé légitime non régressé)", async () => {
    mocks.findFirst.mockResolvedValue({ id: ID_OWN, patientId: 5 })
    const res = await PUT(putReq({ accepted: true }), paramsFor(ID_OWN))
    expect(res.status).toBe(200)
    expect(mocks.respond).toHaveBeenCalledWith(ID_OWN, 5, { accepted: true }, 20, expect.anything())
  })

  it("VIEWER répond à une proposition tierce de son dossier → 404, respond jamais appelé", async () => {
    mocks.findFirst.mockResolvedValue(null)
    const res = await PUT(putReq({ accepted: true }), paramsFor(ID_DOCTOR))
    expect(res.status).toBe(404)
    expect(mocks.respond).not.toHaveBeenCalled()
  })

  it("body invalide (accepted manquant) → 400 validationFailed, respond jamais appelé", async () => {
    mocks.findFirst.mockResolvedValue({ id: ID_OWN, patientId: 5 })
    const res = await PUT(putReq({ comment: "sans accepted" }), paramsFor(ID_OWN))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "validationFailed" })
    expect(mocks.respond).not.toHaveBeenCalled()
  })

  it("commentaire > 500 caractères → 400 validationFailed (garde schema route)", async () => {
    mocks.findFirst.mockResolvedValue({ id: ID_OWN, patientId: 5 })
    const res = await PUT(putReq({ accepted: true, comment: "x".repeat(501) }), paramsFor(ID_OWN))
    expect(res.status).toBe(400)
    expect(mocks.respond).not.toHaveBeenCalled()
  })

  it("pro → 403 sur PUT également (comportement inchangé)", async () => {
    mocks.requireAuth.mockReturnValue({ id: 99, role: "DOCTOR" })
    mocks.getOwnPatientId.mockResolvedValue(null)
    const res = await PUT(putReq({ accepted: true }), paramsFor(ID_OWN))
    expect(res.status).toBe(403)
    expect(mocks.respond).not.toHaveBeenCalled()
  })
})
