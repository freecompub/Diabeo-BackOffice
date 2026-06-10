/**
 * @vitest-environment node
 */

/**
 * Tests — resolvePatientIdFromQuery token-aware (US-2018b).
 *
 * Vérifie l'ordre de résolution : (1) jeton de consultation `x-consultation-token`
 * (workspace pro, aucun id dans l'URL), sinon (2) `?patientId=` historique.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const { resolveConsultationMock, resolvePatientIdMock } = vi.hoisted(() => ({
  resolveConsultationMock: vi.fn(),
  resolvePatientIdMock: vi.fn(),
}))

vi.mock("@/lib/services/consultation.service", () => ({
  resolveConsultation: resolveConsultationMock,
}))
vi.mock("@/lib/access-control", () => ({ resolvePatientId: resolvePatientIdMock }))

import { resolvePatientIdFromQuery, CONSULTATION_TOKEN_HEADER } from "@/lib/auth/query-helpers"

function req(url: string, headers?: Record<string, string>) {
  return new NextRequest(`http://localhost${url}`, { headers })
}

beforeEach(() => vi.clearAllMocks())

describe("resolvePatientIdFromQuery — chemin jeton", () => {
  it("résout via le jeton quand l'en-tête est présent (ignore ?patientId)", async () => {
    resolveConsultationMock.mockResolvedValue(42)
    const res = await resolvePatientIdFromQuery(req("/api/x?patientId=999", { [CONSULTATION_TOKEN_HEADER]: "tok" }), 7, "DOCTOR")
    expect(res).toEqual({ patientId: 42 })
    expect(resolveConsultationMock).toHaveBeenCalledWith("tok", 7)
    expect(resolvePatientIdMock).not.toHaveBeenCalled()
  })

  it("jeton invalide/expiré → patientNotFound (neutre)", async () => {
    resolveConsultationMock.mockResolvedValue(null)
    const res = await resolvePatientIdFromQuery(req("/api/x", { [CONSULTATION_TOKEN_HEADER]: "bad" }), 7, "DOCTOR")
    expect(res).toEqual({ error: "patientNotFound" })
  })
})

describe("resolvePatientIdFromQuery — chemin historique", () => {
  it("sans jeton, résout via ?patientId", async () => {
    resolvePatientIdMock.mockResolvedValue(5)
    const res = await resolvePatientIdFromQuery(req("/api/x?patientId=5"), 7, "DOCTOR")
    expect(res).toEqual({ patientId: 5 })
    expect(resolvePatientIdMock).toHaveBeenCalledWith(7, "DOCTOR", 5)
  })

  it("?patientId malformé → invalidPatientId", async () => {
    const res = await resolvePatientIdFromQuery(req("/api/x?patientId=abc"), 7, "DOCTOR")
    expect(res).toEqual({ error: "invalidPatientId" })
  })
})
