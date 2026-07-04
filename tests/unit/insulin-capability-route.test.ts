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
  it("200 : renvoie le capability avec le rôle de session", async () => {
    const res = await GET(reqWith("5"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toMatchObject({ mode: "basalBolus", canPropose: true })
    expect(mocks.getCapability).toHaveBeenCalledWith("NURSE", 5)
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
