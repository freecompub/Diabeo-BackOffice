/**
 * US-2648b — Route GET /api/insulin-therapy/capability.
 * Vérifie l'accès (resolvePatientId), le passage du rôle, et les gardes consent/accès.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { NextRequest } from "next/server"

const { mocks } = vi.hoisted(() => ({
  mocks: {
    requireAuth: vi.fn(),
    requireGdprConsent: vi.fn(),
    resolvePatientId: vi.fn(),
    getCapability: vi.fn(),
    auditLog: vi.fn(),
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
vi.mock("@/lib/services/treatment-mode.service", () => ({
  treatmentModeService: { getInsulinEditCapability: mocks.getCapability },
}))
vi.mock("@/lib/services/audit.service", () => ({
  auditService: { log: mocks.auditLog },
  extractRequestContext: () => ({ ipAddress: "1.1.1.1", userAgent: "test", requestId: "r1" }),
}))

import { GET } from "@/app/api/insulin-therapy/capability/route"

const reqWith = (patientId?: string) =>
  ({ nextUrl: { searchParams: new URLSearchParams(patientId ? { patientId } : {}) } }) as unknown as NextRequest

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset())
  mocks.requireAuth.mockReturnValue({ id: 20, role: "NURSE" })
  mocks.requireGdprConsent.mockResolvedValue(true)
  mocks.resolvePatientId.mockResolvedValue(5)
  mocks.getCapability.mockResolvedValue({
    mode: "basalBolus",
    coherent: true,
    canEditDirect: false,
    canPropose: true,
    editableParameters: ["insulinSensitivityFactor"],
  })
})

describe("GET /api/insulin-therapy/capability", () => {
  it("200 : renvoie le capability avec le rôle de session + audit READ", async () => {
    const res = await GET(reqWith("5"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toMatchObject({ mode: "basalBolus", canPropose: true })
    expect(mocks.getCapability).toHaveBeenCalledWith("NURSE", 5)
    // lecture d'une donnée de santé (mode) → auditée, pivot patientId, sans PHI en clair.
    expect(mocks.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "READ", resource: "INSULIN_THERAPY", resourceId: "5", metadata: { patientId: 5, view: "capability" } }),
    )
  })

  it("patientNotFound levé par le service (TOCTOU) → 404, pas d'audit", async () => {
    mocks.getCapability.mockRejectedValue(new Error("patientNotFound"))
    const res = await GET(reqWith("5"))
    expect(res.status).toBe(404)
    expect(mocks.auditLog).not.toHaveBeenCalled()
  })

  it("consentement RGPD absent → 403", async () => {
    mocks.requireGdprConsent.mockResolvedValue(false)
    const res = await GET(reqWith("5"))
    expect(res.status).toBe(403)
    expect(mocks.getCapability).not.toHaveBeenCalled()
  })

  it("accès refusé (resolvePatientId null) → 404", async () => {
    mocks.resolvePatientId.mockResolvedValue(null)
    const res = await GET(reqWith("5"))
    expect(res.status).toBe(404)
    expect(mocks.getCapability).not.toHaveBeenCalled()
  })
})
