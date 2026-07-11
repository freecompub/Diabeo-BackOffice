/**
 * US-2648a — Route POST /api/adjustment-proposals (création de proposition).
 *
 * Sécurité testée (obligations route de US-2649a) : accès via resolvePatientId
 * (VIEWER → SON dossier / pro → canAccessPatient), rôle proposeur dérivé de la
 * SESSION (jamais du body ; ADMIN rejeté), réponse SANS proposerComment (ciphertext),
 * mapping des erreurs métier → statuts HTTP stables.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { NextRequest } from "next/server"

const { mocks } = vi.hoisted(() => ({
  mocks: {
    requireAuth: vi.fn(),
    requireGdprConsent: vi.fn(),
    resolvePatientId: vi.fn(),
    createProposal: vi.fn(),
    checkApiRateLimit: vi.fn(),
    rateLimited: vi.fn(),
    accessDenied: vi.fn(),
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
  RATE_LIMITS: { insulinSubmission: { bucket: "insulin-submission", windowSec: 60, max: 20, failMode: "open" } },
}))
vi.mock("@/lib/gdpr", () => ({ requireGdprConsent: mocks.requireGdprConsent }))
vi.mock("@/lib/access-control", () => ({ resolvePatientId: mocks.resolvePatientId }))
vi.mock("@/lib/services/adjustment.service", () => ({
  adjustmentService: { createProposal: mocks.createProposal, list: vi.fn() },
}))
vi.mock("@/lib/services/audit.service", () => ({
  extractRequestContext: () => ({ ipAddress: "1.1.1.1", userAgent: "test" }),
  auditService: { rateLimited: mocks.rateLimited, accessDenied: mocks.accessDenied },
}))

import { POST, GET } from "@/app/api/adjustment-proposals/route"

const isfBody = {
  parameterType: "insulinSensitivityFactor",
  proposedValue: 0.52,
  reason: "manualAdjustment",
  timeSlotStartHour: 8,
  timeSlotEndHour: 12,
}
const reqWith = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest
/** Requête GET (lit `nextUrl.searchParams`) — `patientId` optionnel dans la query. */
const getReq = (patientId?: string) =>
  ({ nextUrl: { searchParams: new URLSearchParams(patientId != null ? { patientId } : {}) } }) as unknown as NextRequest

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset())
  mocks.requireAuth.mockReturnValue({ id: 20, role: "NURSE" })
  mocks.requireGdprConsent.mockResolvedValue(true)
  mocks.resolvePatientId.mockResolvedValue(5)
  mocks.checkApiRateLimit.mockResolvedValue({ allowed: true, remaining: 19, retryAfterSec: 60 })
  mocks.rateLimited.mockResolvedValue({})
  mocks.accessDenied.mockResolvedValue({})
  mocks.createProposal.mockResolvedValue({
    id: "p1",
    proposerComment: "enc(secret)",
    currentValue: 0.5,
    proposedValue: 0.52,
    source: "nurse",
  })
})

describe("POST /api/adjustment-proposals", () => {
  it("NURSE : 201, rôle proposeur 'nurse' dérivé session, proposerComment NON exposé", async () => {
    const res = await POST(reqWith(isfBody))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.id).toBe("p1")
    expect(json).not.toHaveProperty("proposerComment")
    expect(mocks.createProposal).toHaveBeenCalledWith(
      expect.objectContaining({ patientId: 5, parameterType: "insulinSensitivityFactor" }),
      { userId: 20, role: "nurse" },
      expect.anything(),
    )
  })

  it("VIEWER : rôle 'patient', patientId résolu sur SON dossier (body ignoré)", async () => {
    mocks.requireAuth.mockReturnValue({ id: 42, role: "VIEWER" })
    mocks.resolvePatientId.mockResolvedValue(7)
    const res = await POST(reqWith({ ...isfBody, patientId: 999 }))
    expect(res.status).toBe(201)
    // resolvePatientId reçoit le rôle réel ; c'est LUI qui ignore le patientId pour un VIEWER.
    expect(mocks.resolvePatientId).toHaveBeenCalledWith(42, "VIEWER", 999)
    expect(mocks.createProposal).toHaveBeenCalledWith(
      expect.objectContaining({ patientId: 7 }),
      { userId: 42, role: "patient" },
      expect.anything(),
    )
  })

  it("ADMIN : 403 (rôle technique, non clinicien)", async () => {
    mocks.requireAuth.mockReturnValue({ id: 1, role: "ADMIN" })
    const res = await POST(reqWith(isfBody))
    expect(res.status).toBe(403)
    expect(mocks.createProposal).not.toHaveBeenCalled()
  })

  it("DOCTOR : rôle proposeur 'doctor' (les caps patient ne doivent PAS s'appliquer)", async () => {
    mocks.requireAuth.mockReturnValue({ id: 30, role: "DOCTOR" })
    const res = await POST(reqWith(isfBody))
    expect(res.status).toBe(201)
    expect(mocks.createProposal).toHaveBeenCalledWith(
      expect.objectContaining({ patientId: 5 }),
      { userId: 30, role: "doctor" },
      expect.anything(),
    )
  })

  it("consentement RGPD absent → 403, aucune création", async () => {
    mocks.requireGdprConsent.mockResolvedValue(false)
    const res = await POST(reqWith(isfBody))
    expect(res.status).toBe(403)
    expect(mocks.createProposal).not.toHaveBeenCalled()
  })

  it("corps invalide (parameterType manquant) → 400", async () => {
    const res = await POST(reqWith({ proposedValue: 0.52, reason: "manualAdjustment" }))
    expect(res.status).toBe(400)
    expect(mocks.createProposal).not.toHaveBeenCalled()
  })

  it("fixedDose refusé par le schéma → 400", async () => {
    const res = await POST(reqWith({ parameterType: "fixedDose", proposedValue: 10, reason: "manualAdjustment" }))
    expect(res.status).toBe(400)
  })

  it("accès refusé (resolvePatientId null), sans patientId au corps → 404, PAS d'audit accessDenied", async () => {
    mocks.resolvePatientId.mockResolvedValue(null)
    const res = await POST(reqWith(isfBody)) // isfBody n'a pas de patientId → pas une sonde
    expect(res.status).toBe(404)
    expect(mocks.createProposal).not.toHaveBeenCalled()
    expect(mocks.accessDenied).not.toHaveBeenCalled()
  })

  it("pro visant un patientId hors portefeuille → 404 + audit accessDenied (US-2648a)", async () => {
    mocks.resolvePatientId.mockResolvedValue(null)
    const res = await POST(reqWith({ ...isfBody, patientId: 999 }))
    expect(res.status).toBe(404)
    expect(mocks.createProposal).not.toHaveBeenCalled()
    expect(mocks.accessDenied).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 20, resource: "PATIENT", metadata: expect.objectContaining({ patientId: 999 }) }),
    )
  })

  it("rate-limit dépassé → 429 + Retry-After + audit, aucune création", async () => {
    mocks.checkApiRateLimit.mockResolvedValue({ allowed: false, remaining: 0, retryAfterSec: 42 })
    const res = await POST(reqWith(isfBody))
    expect(res.status).toBe(429)
    expect(res.headers.get("Retry-After")).toBe("42")
    expect(mocks.createProposal).not.toHaveBeenCalled()
    // Limiter clé PAR USER (anti DoS partagé / lockout cross-tenant), pas globale ni par patientId.
    expect(mocks.checkApiRateLimit).toHaveBeenCalledWith("20", expect.anything())
    // Audit de saturation : sans PHI (uniquement surface + kind, pas de dose/patient).
    expect(mocks.rateLimited).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 20, resource: "PATIENT", metadata: { surface: "api", kind: "adjustmentProposalCreate" } }),
    )
  })

  it("GET pro visant un patientId hors portefeuille → 404 + audit accessDenied", async () => {
    mocks.resolvePatientId.mockResolvedValue(null)
    const res = await GET(getReq("999"))
    expect(res.status).toBe(404)
    expect(mocks.accessDenied).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 20, resource: "PATIENT", metadata: expect.objectContaining({ patientId: 999 }) }),
    )
  })

  it("GET VIEWER sans dossier (patientId ignoré) → 404, PAS d'audit accessDenied", async () => {
    mocks.requireAuth.mockReturnValue({ id: 42, role: "VIEWER" })
    mocks.resolvePatientId.mockResolvedValue(null)
    const res = await GET(getReq("999"))
    expect(res.status).toBe(404)
    expect(mocks.accessDenied).not.toHaveBeenCalled()
  })

  it("doublon pending → 409", async () => {
    mocks.createProposal.mockRejectedValue(new Error("duplicatePendingProposal"))
    const res = await POST(reqWith(isfBody))
    expect(res.status).toBe(409)
  })

  // US-2659 S3 — baisse basale patient gatée : mapping des nouveaux codes d'erreur.
  it("maturité insuffisante (maturityTooLowForDecrease) → 403", async () => {
    mocks.createProposal.mockRejectedValue(new Error("maturityTooLowForDecrease"))
    expect((await POST(reqWith(isfBody))).status).toBe(403)
  })

  it("accusé DKA manquant (dkaAcknowledgmentRequired) → 422", async () => {
    mocks.createProposal.mockRejectedValue(new Error("dkaAcknowledgmentRequired"))
    expect((await POST(reqWith(isfBody))).status).toBe(422)
  })

  it("discriminateur incohérent (deliveryModeMismatch) → 422", async () => {
    mocks.createProposal.mockRejectedValue(new Error("deliveryModeMismatch"))
    expect((await POST(reqWith(isfBody))).status).toBe(422)
  })

  it("baisse non actionnable (noChangeProposed) → 422", async () => {
    mocks.createProposal.mockRejectedValue(new Error("noChangeProposed"))
    expect((await POST(reqWith(isfBody))).status).toBe(422)
  })

  it("refine Zod : basalDoseKind + pumpBasalSlotId simultanés → 400 (mutually exclusive)", async () => {
    const res = await POST(reqWith({
      parameterType: "basalRate", proposedValue: 20, reason: "patientRequested",
      basalDoseKind: "daily", pumpBasalSlotId: "11111111-1111-1111-1111-111111111111",
    }))
    expect(res.status).toBe(400)
    expect(mocks.createProposal).not.toHaveBeenCalled() // rejeté AVANT le service
  })
})
