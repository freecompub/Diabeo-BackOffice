/**
 * US-2658 — Route de génération de propositions à la demande (`POST /api/patients/[id]/proposals/generate`).
 *
 * Comportement clinique/sécurité testé :
 *  - RBAC : DOCTOR/NURSE autorisés ; VIEWER/patient → 403 (pas de déclenchement moteur par un non-soignant).
 *  - Fenêtre bornée [2,14] : hors bornes → 400 `windowOutOfBounds` (jamais de run silencieux sur fenêtre invalide).
 *  - Anti-IDOR : patient hors périmètre → 404.
 *  - « Rien à proposer » = succès (200 + reason), pas une erreur.
 *  - La fenêtre choisie est transmise au générateur ; l'acte est audité (acteur soignant réel).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/db/client", () => ({ prisma: {} }))
vi.mock("@/lib/gdpr", () => ({ requireGdprConsent: vi.fn().mockResolvedValue(true) }))
vi.mock("@/lib/access-control", () => ({ resolvePatientId: vi.fn() }))
vi.mock("@/lib/services/proposal-generator.service", () => ({
  proposalGeneratorService: { generateForPatient: vi.fn() },
}))
vi.mock("@/lib/services/audit.service", () => ({
  auditService: { log: vi.fn().mockResolvedValue(undefined) },
  extractRequestContext: vi.fn().mockReturnValue({ ipAddress: "127.0.0.1", userAgent: "test" }),
}))

const { POST } = await import("@/app/api/patients/[id]/proposals/generate/route")
const { resolvePatientId } = await import("@/lib/access-control")
const { proposalGeneratorService } = await import("@/lib/services/proposal-generator.service")
const { auditService } = await import("@/lib/services/audit.service")

const resolve = vi.mocked(resolvePatientId)
const generate = vi.mocked(proposalGeneratorService.generateForPatient)
const auditLog = vi.mocked(auditService.log)

const params = (id: string) => ({ params: Promise.resolve({ id }) })
function req(role: string, body: unknown): NextRequest {
  return new NextRequest(new URL("http://localhost/api/patients/42/proposals/generate"), {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": "7", "x-user-role": role },
    body: JSON.stringify(body),
  })
}

describe("POST /api/patients/[id]/proposals/generate", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolve.mockResolvedValue(42)
    generate.mockResolvedValue({ created: 2, flagged: 0, slotsConsidered: 3, mealsUsable: 6, skipped: null })
  })

  it("NURSE, fenêtre valide → 200, générateur appelé avec la fenêtre, audité", async () => {
    const res = await POST(req("NURSE", { windowDays: 4 }), params("42"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ created: 2, flagged: 0, windowDays: 4, reason: null })
    // generateForPatient(patientId, userId, ctx, windowDays)
    expect(generate).toHaveBeenCalledWith(42, 7, expect.anything(), 4)
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "CREATE",
        resource: "ADJUSTMENT_PROPOSAL",
        metadata: expect.objectContaining({ kind: "proposal.generator.on_demand", windowDays: 4, created: 2 }),
      }),
    )
  })

  it("DOCTOR autorisé aussi", async () => {
    const res = await POST(req("DOCTOR", { windowDays: 7 }), params("42"))
    expect(res.status).toBe(200)
  })

  it("fenêtre < 2 → 400 windowOutOfBounds (aucun run)", async () => {
    const res = await POST(req("NURSE", { windowDays: 1 }), params("42"))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("windowOutOfBounds")
    expect(generate).not.toHaveBeenCalled()
  })

  it("fenêtre > 14 → 400 windowOutOfBounds", async () => {
    const res = await POST(req("NURSE", { windowDays: 30 }), params("42"))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("windowOutOfBounds")
  })

  it("VIEWER → 403 (non-soignant ne déclenche pas)", async () => {
    const res = await POST(req("VIEWER", { windowDays: 4 }), params("42"))
    expect(res.status).toBe(403)
    expect(generate).not.toHaveBeenCalled()
  })

  it("patient hors périmètre → 404 (anti-IDOR)", async () => {
    resolve.mockResolvedValue(null)
    const res = await POST(req("NURSE", { windowDays: 4 }), params("99"))
    expect(res.status).toBe(404)
    expect(generate).not.toHaveBeenCalled()
  })

  it("rien à proposer (created 0) → 200 avec reason (pas une erreur)", async () => {
    generate.mockResolvedValue({ created: 0, flagged: 0, slotsConsidered: 2, mealsUsable: 1, skipped: null })
    const res = await POST(req("NURSE", { windowDays: 2 }), params("42"))
    expect(res.status).toBe(200)
    expect((await res.json()).reason).toBe("nothingToPropose")
  })

  it("mode non exploitable → 200 avec le motif du générateur", async () => {
    generate.mockResolvedValue({ created: 0, flagged: 0, slotsConsidered: 0, mealsUsable: 0, skipped: "noCarbRatios" })
    const res = await POST(req("NURSE", { windowDays: 5 }), params("42"))
    expect(res.status).toBe(200)
    expect((await res.json()).reason).toBe("noCarbRatios")
  })
})
