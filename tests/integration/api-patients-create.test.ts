/**
 * @description Integration tests for `POST /api/patients` — new-patient creation.
 *
 * Covers RBAC (NURSE+), Zod validation, content-type guard, the success path
 * (201 + invitation email best-effort) and the duplicate-email business error
 * (409). The service is mocked — the encryption/transaction logic is unit-tested
 * separately in tests/unit/patient-create-with-user.service.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/db/client", () => ({ prisma: {} }))

vi.mock("@/lib/services/patient.service", async (orig) => {
  const actual = await orig<typeof import("@/lib/services/patient.service")>()
  return {
    ...actual,
    patientService: {
      ...actual.patientService,
      createWithNewUser: vi.fn(),
    },
  }
})

vi.mock("@/lib/services/email.service", () => ({
  emailService: { sendPasswordReset: vi.fn().mockResolvedValue({ id: "email-1" }) },
}))

vi.mock("@/lib/services/audit.service", async (orig) => {
  const actual = await orig<typeof import("@/lib/services/audit.service")>()
  return {
    ...actual,
    auditService: { ...actual.auditService, log: vi.fn().mockResolvedValue({}) },
  }
})

import { patientService, PatientCreationError } from "@/lib/services/patient.service"
import { emailService } from "@/lib/services/email.service"

const { POST } = await import("@/app/api/patients/route")

const VALID_BODY = {
  email: "new.patient@example.com",
  firstName: "Jean",
  lastName: "Dupont",
  sex: "M",
  birthday: "1990-05-15",
  pathology: "DT1",
  yearDiag: 2015,
}

function makeReq(
  body: unknown,
  init: { auth?: boolean; role?: string; contentType?: string | null } = {},
): NextRequest {
  const headers = new Headers()
  if (init.auth !== false) {
    headers.set("x-user-id", "1")
    headers.set("x-user-role", init.role ?? "NURSE")
  }
  if (init.contentType !== null) {
    headers.set("content-type", init.contentType ?? "application/json")
  }
  return new NextRequest(new URL("/api/patients", "http://test.local"), {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("POST /api/patients", () => {
  it("401 without JWT", async () => {
    const res = await POST(makeReq(VALID_BODY, { auth: false }))
    expect(res.status).toBe(401)
    expect(patientService.createWithNewUser).not.toHaveBeenCalled()
  })

  it("403 for VIEWER (below NURSE)", async () => {
    const res = await POST(makeReq(VALID_BODY, { role: "VIEWER" }))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe("forbidden")
    expect(patientService.createWithNewUser).not.toHaveBeenCalled()
  })

  it("415 on non-JSON content-type", async () => {
    const res = await POST(makeReq(VALID_BODY, { contentType: "text/plain" }))
    expect(res.status).toBe(415)
    expect(patientService.createWithNewUser).not.toHaveBeenCalled()
  })

  it("400 validationFailed on invalid body (bad email + bad pathology)", async () => {
    const res = await POST(
      makeReq({ ...VALID_BODY, email: "not-an-email", pathology: "DTX" }),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("validationFailed")
    expect(patientService.createWithNewUser).not.toHaveBeenCalled()
  })

  it("400 validationFailed on malformed JSON", async () => {
    const res = await POST(makeReq("{not json", { contentType: "application/json" }))
    expect(res.status).toBe(400)
  })

  it("201 creates the patient and sends the invitation email", async () => {
    vi.mocked(patientService.createWithNewUser).mockResolvedValue({
      id: 42,
      userId: 77,
      pathology: "DT1" as any,
      resetToken: "tok-123",
    })

    const res = await POST(makeReq(VALID_BODY))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ id: 42, pathology: "DT1" })

    // Service received normalised + parsed data (email lowercased, yearDiag int).
    expect(patientService.createWithNewUser).toHaveBeenCalledTimes(1)
    const [input, auditUserId] = vi.mocked(patientService.createWithNewUser).mock.calls[0]
    expect(auditUserId).toBe(1)
    expect(input.email).toBe("new.patient@example.com")
    expect(input.pathology).toBe("DT1")
    expect(input.yearDiag).toBe(2015)
    expect(input.birthday).toBe("1990-05-15")

    // Invitation email sent best-effort with the returned token.
    expect(emailService.sendPasswordReset).toHaveBeenCalledWith(
      "new.patient@example.com",
      "tok-123",
    )
  })

  it("does not leak the resetToken in the response", async () => {
    vi.mocked(patientService.createWithNewUser).mockResolvedValue({
      id: 42,
      userId: 77,
      pathology: "DT1" as any,
      resetToken: "super-secret-token",
    })
    const res = await POST(makeReq(VALID_BODY))
    const json = await res.json()
    expect(JSON.stringify(json)).not.toContain("super-secret-token")
    expect(json).not.toHaveProperty("resetToken")
    expect(json).not.toHaveProperty("userId")
  })

  it("409 emailExists when the email is already in use", async () => {
    vi.mocked(patientService.createWithNewUser).mockRejectedValue(
      new PatientCreationError("emailExists"),
    )
    const res = await POST(makeReq(VALID_BODY))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe("emailExists")
    expect(emailService.sendPasswordReset).not.toHaveBeenCalled()
  })

  it("201 succeeds even if the invitation email fails (best-effort)", async () => {
    vi.mocked(patientService.createWithNewUser).mockResolvedValue({
      id: 7,
      userId: 8,
      pathology: "DT2" as any,
      resetToken: "tok",
    })
    vi.mocked(emailService.sendPasswordReset).mockRejectedValue(new Error("smtp down"))

    const res = await POST(makeReq({ ...VALID_BODY, pathology: "DT2" }))
    expect(res.status).toBe(201)
  })
})
