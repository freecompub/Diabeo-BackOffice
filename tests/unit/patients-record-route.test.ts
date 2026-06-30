/**
 * Test suite — GET /api/patients/record (US-2633).
 *
 * Surface de sécurité : la route alimente la fiche patient (page + drawer cTok).
 * On vérifie la chaîne de gardes AVANT projection (consentement RGPD →
 * résolution + scope patient) et le câblage (assemblage + audit « surface »).
 * Les gardes sous-jacentes (`requireAuth`, `resolvePatientIdFromQuery`,
 * `requireGdprConsent`) ont leurs propres suites — ici on mocke pour isoler le
 * contrat de la route.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
  AuthError: class AuthError extends Error {
    status = 401
  },
}))
vi.mock("@/lib/gdpr", () => ({ requireGdprConsent: vi.fn() }))
vi.mock("@/lib/auth/query-helpers", () => ({ resolvePatientIdFromQuery: vi.fn() }))
vi.mock("@/lib/services/audit.service", () => ({
  auditService: { log: vi.fn() },
  extractRequestContext: vi.fn(() => ({ ipAddress: "i", userAgent: "u", requestId: "r" })),
}))
vi.mock("@/app/(dashboard)/patients/[id]/build-patient-record", () => ({
  buildPatientRecordData: vi.fn(),
}))

import { GET } from "@/app/api/patients/record/route"
import { requireAuth } from "@/lib/auth"
import { requireGdprConsent } from "@/lib/gdpr"
import { resolvePatientIdFromQuery } from "@/lib/auth/query-helpers"
import { buildPatientRecordData } from "@/app/(dashboard)/patients/[id]/build-patient-record"
import { auditService } from "@/lib/services/audit.service"

const req = {} as any
const mAuth = vi.mocked(requireAuth)
const mConsent = vi.mocked(requireGdprConsent)
const mResolve = vi.mocked(resolvePatientIdFromQuery)
const mBuild = vi.mocked(buildPatientRecordData)
const mLog = vi.mocked(auditService.log)

beforeEach(() => {
  vi.clearAllMocks()
  mAuth.mockReturnValue({ id: 1, role: "DOCTOR" } as any)
  mConsent.mockResolvedValue(true)
  mResolve.mockResolvedValue({ patientId: 42 } as any)
  mBuild.mockResolvedValue({ id: 42, name: "X" } as any)
})

describe("GET /api/patients/record", () => {
  it("403 when the caller has no GDPR consent (before any patient resolution)", async () => {
    mConsent.mockResolvedValue(false)
    const r = await GET(req)
    expect(r.status).toBe(403)
    expect(mResolve).not.toHaveBeenCalled()
    expect(mBuild).not.toHaveBeenCalled()
  })

  it("400 when patientId is malformed", async () => {
    mResolve.mockResolvedValue({ error: "invalidPatientId" } as any)
    const r = await GET(req)
    expect(r.status).toBe(400)
    expect(mBuild).not.toHaveBeenCalled()
  })

  it("404 (uniform) when access is denied / no patient / bad token", async () => {
    mResolve.mockResolvedValue({ error: "patientNotFound" } as any)
    const r = await GET(req)
    expect(r.status).toBe(404)
  })

  it("404 when the patient record cannot be built (deleted patient)", async () => {
    mBuild.mockResolvedValue(null)
    const r = await GET(req)
    expect(r.status).toBe(404)
  })

  it("200 returns the DTO and writes a surface audit row (no PHI in metadata)", async () => {
    const r = await GET(req)
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ id: 42, name: "X" })
    expect(mBuild).toHaveBeenCalledWith(42, "DOCTOR", 1, expect.any(Object))
    const data = mLog.mock.calls.at(-1)![0]
    expect(data.resource).toBe("PATIENT")
    expect(data.metadata).toEqual({ patientId: 42, kind: "patientRecord", surface: "api" })
  })
})
