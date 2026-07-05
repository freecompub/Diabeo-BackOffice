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
  },
}))
vi.mock("@/lib/auth", () => {
  class AuthError extends Error {
    status = 401
  }
  return { requireAuth: mocks.requireAuth, AuthError }
})
vi.mock("@/lib/gdpr", () => ({ requireGdprConsent: mocks.requireGdprConsent }))
vi.mock("@/lib/access-control", () => ({ resolvePatientId: mocks.resolvePatientId }))
vi.mock("@/lib/services/adjustment.service", () => ({
  adjustmentService: { createProposal: mocks.createProposal, list: vi.fn() },
}))
vi.mock("@/lib/services/audit.service", () => ({
  extractRequestContext: () => ({ ipAddress: "1.1.1.1", userAgent: "test" }),
}))

import { POST } from "@/app/api/adjustment-proposals/route"

const isfBody = {
  parameterType: "insulinSensitivityFactor",
  proposedValue: 0.52,
  reason: "manualAdjustment",
  timeSlotStartHour: 8,
  timeSlotEndHour: 12,
}
const reqWith = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset())
  mocks.requireAuth.mockReturnValue({ id: 20, role: "NURSE" })
  mocks.requireGdprConsent.mockResolvedValue(true)
  mocks.resolvePatientId.mockResolvedValue(5)
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

  it("accès refusé (resolvePatientId null) → 404", async () => {
    mocks.resolvePatientId.mockResolvedValue(null)
    const res = await POST(reqWith(isfBody))
    expect(res.status).toBe(404)
    expect(mocks.createProposal).not.toHaveBeenCalled()
  })

  it("doublon pending → 409", async () => {
    mocks.createProposal.mockRejectedValue(new Error("duplicatePendingProposal"))
    const res = await POST(reqWith(isfBody))
    expect(res.status).toBe(409)
  })

  it("garde-fou clinique (patientDecreaseForbidden) → 422", async () => {
    mocks.createProposal.mockRejectedValue(new Error("patientDecreaseForbidden"))
    const res = await POST(reqWith(isfBody))
    expect(res.status).toBe(422)
  })
})
