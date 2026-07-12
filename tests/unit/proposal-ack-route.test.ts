/**
 * US-2665 — Route POST/PUT /api/team/proposal-ack/[proposalId] : frontière de provenance
 * sur l'accusé/réponse d'une proposition d'ajustement.
 *
 * Risque clinique testé : un patient (VIEWER) connaissant l'UUID d'une proposition
 * `nurse`/`doctor`/`algorithm` de SON dossier ne doit PAS pouvoir l'acquitter ni y répondre
 * (divulgation d'existence d'une décision non validée — frontière MDR, ADR #13). La frontière
 * doit être IDENTIQUE à la lecture (`viewerProposalSources` → VIEWER = ['patient']) et NON
 * énumérante (404 uniforme, jamais 200, jamais 403 distinct de « inexistant »).
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
  },
}))

vi.mock("@/lib/auth", () => {
  class AuthError extends Error {
    status = 401
  }
  return { requireAuth: mocks.requireAuth, AuthError }
})
vi.mock("@/lib/access-control", () => ({
  getOwnPatientId: mocks.getOwnPatientId,
  // Helper pur (US-2664/US-2665) — reproduit le vrai comportement : VIEWER → ["patient"], pros → undefined.
  viewerProposalSources: (role: string) => (role === "VIEWER" ? ["patient"] : undefined),
}))
vi.mock("@/lib/db/client", () => ({
  prisma: { adjustmentProposal: { findFirst: mocks.findFirst } },
}))
vi.mock("@/lib/services/team-workflow.service", () => ({
  proposalAckService: { markRead: mocks.markRead, respond: mocks.respond },
}))
vi.mock("@/lib/services/audit.service", () => ({
  extractRequestContext: () => ({ ipAddress: "1.1.1.1", userAgent: "test", requestId: "req-1" }),
}))
vi.mock("@/lib/team-route-helpers", () => ({
  mapErrorToResponse: () => new Response(JSON.stringify({ error: "serverError" }), { status: 500 }),
}))

import { POST, PUT } from "@/app/api/team/proposal-ack/[proposalId]/route"

const paramsFor = (proposalId: string) => ({ params: Promise.resolve({ proposalId }) })
const putReq = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest
const emptyReq = {} as unknown as NextRequest

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset())
  mocks.requireAuth.mockReturnValue({ id: 20, role: "VIEWER" })
  mocks.getOwnPatientId.mockResolvedValue(5)
  mocks.markRead.mockResolvedValue({ id: "ack1", readAt: new Date("2026-07-12T00:00:00Z") })
  mocks.respond.mockResolvedValue({ id: "ack1", accepted: true, respondedAt: new Date("2026-07-12T00:00:00Z") })
})

describe("US-2665 — provenance frontier on proposal-ack (POST markRead)", () => {
  it("AC-1 — VIEWER acquitte SA propre demande (source=patient) → 200 + filtre de provenance imposé", async () => {
    mocks.findFirst.mockResolvedValue({ id: "p1", patientId: 5 })
    const res = await POST(emptyReq, paramsFor("p1"))
    expect(res.status).toBe(200)
    expect(mocks.markRead).toHaveBeenCalledWith("p1", 5, 20, expect.anything())
    // La requête d'ownership DOIT porter le filtre `source IN ['patient']` (imposé serveur, pas la query).
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "p1", patientId: 5, source: { in: ["patient"] } }),
      }),
    )
  })

  it("AC-1 — VIEWER acquitte une proposition TIERCE (nurse/doctor/algo) de son dossier → 404, jamais 200", async () => {
    // findFirst renvoie null : le filtre de provenance exclut la proposition non-patient.
    mocks.findFirst.mockResolvedValue(null)
    const res = await POST(emptyReq, paramsFor("p-nurse"))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: "notFound" })
    expect(mocks.markRead).not.toHaveBeenCalled()
  })

  it("AC-1 — VIEWER, UUID inexistant → 404 (réponse identique au cas tierce : non énumérant)", async () => {
    mocks.findFirst.mockResolvedValue(null)
    const res = await POST(emptyReq, paramsFor("does-not-exist"))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: "notFound" })
  })

  it("AC-2 — un pro (pas de dossier patient propre) → 403 INCHANGÉ, sans filtre de provenance", async () => {
    mocks.requireAuth.mockReturnValue({ id: 99, role: "NURSE" })
    mocks.getOwnPatientId.mockResolvedValue(null)
    const res = await POST(emptyReq, paramsFor("p1"))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: "forbidden" })
    expect(mocks.findFirst).not.toHaveBeenCalled()
  })
})

describe("US-2665 — provenance frontier on proposal-ack (PUT respond)", () => {
  it("AC-3 — VIEWER répond à SA demande (source=patient) → 200 (accusé légitime non régressé)", async () => {
    mocks.findFirst.mockResolvedValue({ id: "p1", patientId: 5 })
    const res = await PUT(putReq({ accepted: true }), paramsFor("p1"))
    expect(res.status).toBe(200)
    expect(mocks.respond).toHaveBeenCalledWith("p1", 5, { accepted: true }, 20, expect.anything())
  })

  it("AC-1 — VIEWER répond à une proposition tierce de son dossier → 404, respond jamais appelé", async () => {
    mocks.findFirst.mockResolvedValue(null)
    const res = await PUT(putReq({ accepted: true }), paramsFor("p-doctor"))
    expect(res.status).toBe(404)
    expect(mocks.respond).not.toHaveBeenCalled()
  })

  it("AC-2 — pro → 403 sur PUT également (comportement inchangé)", async () => {
    mocks.requireAuth.mockReturnValue({ id: 99, role: "DOCTOR" })
    mocks.getOwnPatientId.mockResolvedValue(null)
    const res = await PUT(putReq({ accepted: true }), paramsFor("p1"))
    expect(res.status).toBe(403)
    expect(mocks.respond).not.toHaveBeenCalled()
  })
})
