/**
 * US-2650 — Route GET /api/patient/insulin-settings (self-service patient).
 *
 * Comportement clinique/sécurité testé :
 * - Own-id STRICT : le patient est résolu depuis `user.id` (`getOwnPatientId`),
 *   jamais depuis `?patientId` ni un jeton → anti-IDOR / anti-énumération (AC-1).
 * - Un utilisateur sans dossier patient (pro) → 404 neutre.
 * - Garde consentement RGPD.
 * Risque couvert : un patient ne doit JAMAIS lire la thérapie d'un autre.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { NextRequest } from "next/server"

const { mocks } = vi.hoisted(() => ({
  mocks: {
    requireAuth: vi.fn(),
    requireGdprConsent: vi.fn(),
    getOwnPatientId: vi.fn(),
    getSettings: vi.fn(),
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
vi.mock("@/lib/access-control", () => ({ getOwnPatientId: mocks.getOwnPatientId }))
vi.mock("@/lib/services/insulin.service", () => ({ insulinService: { getSettings: mocks.getSettings } }))
vi.mock("@/lib/services/audit.service", () => ({
  auditService: { log: mocks.auditLog },
  extractRequestContext: () => ({ ipAddress: "1.1.1.1", userAgent: "test", requestId: "r1" }),
}))

import { GET } from "@/app/api/patient/insulin-settings/route"

// Requête avec un éventuel `?patientId` — qui DOIT être ignoré (own-id strict).
const reqWith = (patientId?: string) =>
  ({ nextUrl: { searchParams: new URLSearchParams(patientId ? { patientId } : {}) } }) as unknown as NextRequest

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset())
  mocks.requireAuth.mockReturnValue({ id: 20, role: "VIEWER" })
  mocks.requireGdprConsent.mockResolvedValue(true)
  mocks.getOwnPatientId.mockResolvedValue(7)
  mocks.getSettings.mockResolvedValue({ id: 1, basalConfig: null })
})

describe("GET /api/patient/insulin-settings (self-service patient)", () => {
  it("200 : lit la thérapie du patient connecté (own-id) + audit READ", async () => {
    const res = await GET(reqWith())
    expect(res.status).toBe(200)
    expect(mocks.getOwnPatientId).toHaveBeenCalledWith(20)
    expect(mocks.getSettings).toHaveBeenCalledWith(7)
    expect(mocks.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "READ", resource: "PATIENT", resourceId: "7", metadata: { patientId: 7, kind: "insulin_settings" } }),
    )
  })

  it("anti-IDOR : `?patientId=999` est IGNORÉ — renvoie toujours SON dossier (AC-1)", async () => {
    const res = await GET(reqWith("999"))
    expect(res.status).toBe(200)
    // Résolu depuis user.id (7), jamais depuis l'URL (999).
    expect(mocks.getSettings).toHaveBeenCalledWith(7)
    expect(mocks.getSettings).not.toHaveBeenCalledWith(999)
  })

  it("utilisateur sans dossier patient (pro) → 404 neutre, pas de lecture", async () => {
    mocks.getOwnPatientId.mockResolvedValue(null)
    const res = await GET(reqWith())
    expect(res.status).toBe(404)
    expect(mocks.getSettings).not.toHaveBeenCalled()
    expect(mocks.auditLog).not.toHaveBeenCalled()
  })

  it("consentement RGPD absent → 403", async () => {
    mocks.requireGdprConsent.mockResolvedValue(false)
    const res = await GET(reqWith())
    expect(res.status).toBe(403)
    expect(mocks.getOwnPatientId).not.toHaveBeenCalled()
  })
})
