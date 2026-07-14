/**
 * US-2663 (S5/c4) — Route POST /api/team/slot-set-proposal-actualization/[proposalId] :
 * enregistrement de l'application RÉELLE (sur device) d'une proposition GROUPÉE (SlotSetProposal).
 *
 * Risque clinique / sécurité testé : port grouped-only de US-2066. La vérification qu'un ajustement
 * a bien pris effet dans le monde réel est réservée à un soignant AUTORISÉ sur le patient concerné
 * (anti-IDOR). Chaîne fail-closed : rôle NURSE (auditedRequireRole) → UUID valide → patient résolu
 * SERVEUR (getProposalPatientId) → canAccessPatient (403 + audit si refus) → consentement de partage.
 * `patientId` jamais lu du body (anti-tamper). Ne teste PAS iOS.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { NextRequest } from "next/server"

const { mocks } = vi.hoisted(() => ({
  mocks: {
    auditedRequireRole: vi.fn(),
    canAccessPatient: vi.fn(),
    patientShareConsent: vi.fn(),
    getProposalPatientId: vi.fn(),
    record: vi.fn(),
    accessDenied: vi.fn(),
  },
}))

vi.mock("@/lib/auth", () => {
  class AuthError extends Error {
    status = 401
  }
  return { AuthError }
})
vi.mock("@/lib/access-control", () => ({ canAccessPatient: mocks.canAccessPatient }))
vi.mock("@/lib/consent", () => ({ patientShareConsent: mocks.patientShareConsent }))
vi.mock("@/lib/services/team-workflow.service", () => ({
  slotSetProposalActualizationService: {
    getProposalPatientId: mocks.getProposalPatientId,
    record: mocks.record,
  },
}))
vi.mock("@/lib/services/audit.service", () => ({
  extractRequestContext: () => ({ ipAddress: "1.1.1.1", userAgent: "test", requestId: "req-1" }),
  auditService: { accessDenied: mocks.accessDenied },
}))
vi.mock("@/lib/team-route-helpers", () => ({
  auditedRequireRole: mocks.auditedRequireRole,
  mapErrorToResponse: () => new Response(JSON.stringify({ error: "serverError" }), { status: 500 }),
}))

import { POST } from "@/app/api/team/slot-set-proposal-actualization/[proposalId]/route"

const UUID = "11111111-1111-1111-1111-111111111111"
const paramsFor = (proposalId: string) => ({ params: Promise.resolve({ proposalId }) })
const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset())
  mocks.auditedRequireRole.mockResolvedValue({ id: 30, role: "NURSE" })
  mocks.getProposalPatientId.mockResolvedValue(5)
  mocks.canAccessPatient.mockResolvedValue(true)
  mocks.patientShareConsent.mockResolvedValue({ ok: true })
  mocks.record.mockResolvedValue({ id: 1, slotSetProposalId: UUID, verifiedVia: "manual-ps" })
  mocks.accessDenied.mockResolvedValue({})
})

describe("slot-set-proposal-actualization (POST record)", () => {
  it("NURSE autorisé + consentement → 201 + record appelé (patientId dérivé serveur)", async () => {
    const res = await POST(req({ verifiedVia: "manual-ps" }), paramsFor(UUID))
    expect(res.status).toBe(201)
    expect(mocks.getProposalPatientId).toHaveBeenCalledWith(UUID)
    expect(mocks.record).toHaveBeenCalledWith(UUID, { verifiedVia: "manual-ps" }, 30, expect.anything())
  })

  it("UUID mal formé → 400 invalidProposalId (jamais de lookup)", async () => {
    const res = await POST(req({ verifiedVia: "manual-ps" }), paramsFor("not-a-uuid"))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "invalidProposalId" })
    expect(mocks.auditedRequireRole).not.toHaveBeenCalled()
  })

  it("proposition inexistante (patientId null) → 404 proposalNotFound", async () => {
    mocks.getProposalPatientId.mockResolvedValue(null)
    const res = await POST(req({ verifiedVia: "manual-ps" }), paramsFor(UUID))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: "proposalNotFound" })
    expect(mocks.record).not.toHaveBeenCalled()
  })

  it("patient hors portefeuille (canAccessPatient false) → 403 + audit accessDenied (anti-IDOR)", async () => {
    mocks.canAccessPatient.mockResolvedValue(false)
    const res = await POST(req({ verifiedVia: "manual-ps" }), paramsFor(UUID))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: "forbidden" })
    expect(mocks.record).not.toHaveBeenCalled()
    expect(mocks.accessDenied).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 30,
        resource: "PROPOSAL_ACTUALIZATION",
        resourceId: UUID,
        metadata: expect.objectContaining({ patientId: 5, model: "slotSet", endpoint: "record" }),
      }),
    )
  })

  it("consentement de partage refusé → statut du consentement (fail-closed)", async () => {
    mocks.patientShareConsent.mockResolvedValue({ ok: false, error: "shareConsentRequired", status: 403 })
    const res = await POST(req({ verifiedVia: "manual-ps" }), paramsFor(UUID))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: "shareConsentRequired" })
    expect(mocks.record).not.toHaveBeenCalled()
  })

  it("verifiedVia invalide → 400 validationFailed, record jamais appelé", async () => {
    const res = await POST(req({ verifiedVia: "hearsay" }), paramsFor(UUID))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "validationFailed" })
    expect(mocks.record).not.toHaveBeenCalled()
  })
})
