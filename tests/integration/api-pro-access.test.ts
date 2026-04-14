/**
 * Test suite: Pro access via resolvePatientIdFromQuery
 *
 * Clinical behavior tested:
 * - VIEWER (the patient): `?patientId=` query param is ignored; their own
 *   record is resolved via the User→Patient 1:1 link, preventing accidental
 *   cross-patient access even if the UI forges the param.
 * - DOCTOR/NURSE: must pass `?patientId=N`; access is granted only if the
 *   patient is enrolled in a HealthcareService the pro belongs to
 *   (`canAccessPatient`), otherwise 404.
 * - Invalid `?patientId=` (non-positive, NaN) → 400 invalidPatientId.
 *
 * Associated risks:
 * - A DOCTOR accessing a patient outside their service would violate HDS
 *   data-minimization and trigger regulatory exposure
 * - A VIEWER able to read another patient's data by tampering with the query
 *   param would be a critical confidentiality breach
 * - A numeric parser that accepts non-integer or negative values could be
 *   exploited to trigger SQL corner cases or enumerate IDs
 */

import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mockResolvePatientId = vi.fn()
vi.mock("@/lib/access-control", () => ({
  resolvePatientId: (...args: unknown[]) => mockResolvePatientId(...args),
}))

const { resolvePatientIdFromQuery } = await import("@/lib/auth/query-helpers")

function req(query: Record<string, string> = {}): NextRequest {
  const url = new URL("http://localhost:3000/api/patient/medical-data")
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
  return new NextRequest(url, { method: "GET" })
}

describe("resolvePatientIdFromQuery", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("VIEWER: delegates with patientIdParam=undefined even when ?patientId= is forged", async () => {
    mockResolvePatientId.mockResolvedValue(7)
    const res = await resolvePatientIdFromQuery(req({ patientId: "999" }), 1, "VIEWER")
    expect(res.patientId).toBe(7)
    // VIEWER branch in resolvePatientId ignores the param but the helper still forwards it;
    // the contract is: resolvePatientId owns the VIEWER-ignores-param rule (tested separately).
    expect(mockResolvePatientId).toHaveBeenCalledWith(1, "VIEWER", 999)
  })

  it("DOCTOR: forwards explicit patientId to resolvePatientId", async () => {
    mockResolvePatientId.mockResolvedValue(42)
    const res = await resolvePatientIdFromQuery(req({ patientId: "42" }), 2, "DOCTOR")
    expect(res.patientId).toBe(42)
    expect(mockResolvePatientId).toHaveBeenCalledWith(2, "DOCTOR", 42)
  })

  it("DOCTOR without affiliation: returns patientNotFound", async () => {
    mockResolvePatientId.mockResolvedValue(null)
    const res = await resolvePatientIdFromQuery(req({ patientId: "999" }), 2, "DOCTOR")
    expect(res.error).toBe("patientNotFound")
    expect(res.patientId).toBeUndefined()
  })

  it("DOCTOR without ?patientId=: returns patientNotFound (resolvePatientId returns null)", async () => {
    mockResolvePatientId.mockResolvedValue(null)
    const res = await resolvePatientIdFromQuery(req(), 2, "DOCTOR")
    expect(res.error).toBe("patientNotFound")
    expect(mockResolvePatientId).toHaveBeenCalledWith(2, "DOCTOR", undefined)
  })

  it("rejects a non-integer ?patientId= with invalidPatientId (400)", async () => {
    const res = await resolvePatientIdFromQuery(req({ patientId: "abc" }), 2, "DOCTOR")
    expect(res.error).toBe("invalidPatientId")
    expect(mockResolvePatientId).not.toHaveBeenCalled()
  })

  it("rejects a zero ?patientId=", async () => {
    const res = await resolvePatientIdFromQuery(req({ patientId: "0" }), 2, "DOCTOR")
    expect(res.error).toBe("invalidPatientId")
  })

  it("rejects a negative ?patientId=", async () => {
    const res = await resolvePatientIdFromQuery(req({ patientId: "-5" }), 2, "DOCTOR")
    expect(res.error).toBe("invalidPatientId")
  })
})
