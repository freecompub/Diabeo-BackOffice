/**
 * @description Plan B follow-up A2 — Integration tests
 * `POST /api/auth/mfa/step-up`.
 *
 * Couvre :
 *   - 401 sans sessionId (JWT legacy)
 *   - 400 validation otp
 *   - 403 mfaEnrollmentRequired si mfaEnabled=false
 *   - 401 invalidOtp + audit MFA_CHALLENGE_FAILED
 *   - 429 rate-limit après 3 échecs
 *   - 200 succès + audit MFA_STEP_UP_VERIFIED + verifiedAt/expiresAt
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/db/client", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
  },
}))

vi.mock("@/lib/services/mfa.service", () => ({
  mfaService: {
    stepUp: vi.fn(),
  },
}))

vi.mock("@/lib/services/audit.service", async (orig) => {
  const actual = await orig<typeof import("@/lib/services/audit.service")>()
  return {
    ...actual,
    auditService: {
      ...actual.auditService,
      log: vi.fn().mockResolvedValue({}),
    },
  }
})

vi.mock("@/lib/auth", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth")>()
  return {
    ...actual,
    checkRateLimit: vi.fn(() => Promise.resolve({ blocked: false })),
    recordFailedAttempt: vi.fn(() => Promise.resolve(undefined)),
    clearAttempts: vi.fn(() => Promise.resolve(undefined)),
  }
})

import { prisma } from "@/lib/db/client"
import { mfaService } from "@/lib/services/mfa.service"
import { auditService } from "@/lib/services/audit.service"
import { checkRateLimit } from "@/lib/auth"

const { POST } = await import("@/app/api/auth/mfa/step-up/route")

function makeReq(body: unknown, init: { sid?: string | null; userId?: string } = {}): NextRequest {
  const headers = new Headers({
    "content-type": "application/json",
    "x-user-id": init.userId ?? "42",
    "x-user-role": "ADMIN",
  })
  if (init.sid !== null) headers.set("x-session-id", init.sid ?? "sess-abc")
  return new NextRequest(new URL("http://test.local/api/auth/mfa/step-up"), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  // Restore default — checkRateLimit non-bloqué pour tous les tests sauf le
  // test "429" qui override explicitement.
  vi.mocked(checkRateLimit).mockResolvedValue({ blocked: false } as never)
})

describe("POST /api/auth/mfa/step-up", () => {
  it("401 sessionRequired si pas de x-session-id (legacy JWT)", async () => {
    const res = await POST(makeReq({ otp: "123456" }, { sid: null }))
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe("sessionRequired")
  })

  it("400 validationFailed si otp manquant ou mal formé", async () => {
    const res = await POST(makeReq({ otp: "abc" }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe("validationFailed")
  })

  it("LOW-4 — 401 mfaEnrollmentRequired + WWW-Authenticate + X-Step-Up-Required (alignement)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      mfaEnabled: false,
    } as never)
    const res = await POST(makeReq({ otp: "123456" }))
    // A2 round 2 LOW-4 — aligné sur 401 + WWW-Authenticate (vs ancien 403 sans header).
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe("mfaEnrollmentRequired")
    expect(res.headers.get("WWW-Authenticate")).toContain(
      `stepup reason="mfaEnrollmentRequired"`,
    )
    expect(res.headers.get("X-Step-Up-Required")).toBe("mfaEnrollmentRequired")
    expect(res.headers.get("Cache-Control")).toContain("no-store")
    expect(mfaService.stepUp).not.toHaveBeenCalled()
  })

  it("401 invalidOtp si stepUp retourne null + audit MFA_CHALLENGE_FAILED", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      mfaEnabled: true,
    } as never)
    vi.mocked(mfaService.stepUp).mockResolvedValue(null)

    const res = await POST(makeReq({ otp: "123456" }))
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe("invalidOtp")

    // Audit avec phase=step-up
    expect(auditService.log).toHaveBeenCalledTimes(1)
    expect(vi.mocked(auditService.log).mock.calls[0]?.[0]).toMatchObject({
      action: "MFA_CHALLENGE_FAILED",
      metadata: { phase: "step-up" },
    })
  })

  it("429 si rate-limit bloqué + Retry-After", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({
      blocked: true,
      retryAfterSeconds: 300,
    } as never)
    const res = await POST(makeReq({ otp: "123456" }))
    expect(res.status).toBe(429)
    expect(res.headers.get("Retry-After")).toBe("300")
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
  })

  it("200 succès → verifiedAt + expiresAt + audit MFA_STEP_UP_VERIFIED + ANSSI headers", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      mfaEnabled: true,
    } as never)
    const verifiedAt = new Date("2026-05-28T15:00:00Z")
    vi.mocked(mfaService.stepUp).mockResolvedValue(verifiedAt)

    const res = await POST(makeReq({ otp: "123456" }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.verifiedAt).toBe(verifiedAt.toISOString())
    // M-1 — expiresAt aligné STEP_UP_WINDOW_SECONDS (vs ancien magic 5*60_000)
    expect(new Date(json.expiresAt).getTime()).toBe(verifiedAt.getTime() + 5 * 60_000)

    expect(auditService.log).toHaveBeenCalledTimes(1)
    expect(vi.mocked(auditService.log).mock.calls[0]?.[0]).toMatchObject({
      action: "MFA_STEP_UP_VERIFIED",
      resource: "SESSION",
      resourceId: "sess-abc",
    })

    // A2 round 2 H-1 — ANSSI baseline sur 200 succès aussi
    expect(res.headers.get("Cache-Control")).toContain("no-store")
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff")
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer")
  })

  // A2 round 2 H-T3 — Si clearAttempts throw, audit MFA_STEP_UP_VERIFIED
  // doit quand-même être émis (preuve forensique HDS préservée).
  it("H-T3 — clearAttempts throw → audit MFA_STEP_UP_VERIFIED quand-même émis + 200", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      mfaEnabled: true,
    } as never)
    const verifiedAt = new Date()
    vi.mocked(mfaService.stepUp).mockResolvedValue(verifiedAt)
    // Patch clearAttempts pour throw
    const { clearAttempts } = await import("@/lib/auth")
    vi.mocked(clearAttempts).mockRejectedValueOnce(new Error("Redis down"))

    const res = await POST(makeReq({ otp: "123456" }))
    expect(res.status).toBe(200)
    // Audit MFA_STEP_UP_VERIFIED appelé même si clearAttempts a throw
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: "MFA_STEP_UP_VERIFIED" }),
    )
  })

  // A2 round 2 H-T3 — Si auditService.log throw, response 200 reste retournée
  // (la session est déjà bumpée — le user ne doit pas voir un faux échec).
  it("H-T3 — audit MFA_STEP_UP_VERIFIED throw → response 200 quand-même + session bumpée", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      mfaEnabled: true,
    } as never)
    vi.mocked(mfaService.stepUp).mockResolvedValue(new Date())
    vi.mocked(auditService.log).mockRejectedValueOnce(new Error("DB down"))

    const res = await POST(makeReq({ otp: "123456" }))
    expect(res.status).toBe(200)
  })

  // L9 — assertJsonContentType 415
  it("L9 — Content-Type: text/plain → 415 unsupportedMediaType + ANSSI headers", async () => {
    const headers = new Headers({
      "content-type": "text/plain",
      "x-user-id": "1",
      "x-user-role": "ADMIN",
      "x-session-id": "sess-abc",
    })
    const req = new NextRequest(new URL("http://test.local/api/auth/mfa/step-up"), {
      method: "POST",
      headers,
      body: "otp=123456",
    })
    const res = await POST(req)
    expect(res.status).toBe(415)
    expect(res.headers.get("Cache-Control")).toContain("no-store")
  })

  // L9 — assertBodySize 413
  it("L9 — Content-Length > 1024 → 413 payloadTooLarge", async () => {
    const headers = new Headers({
      "content-type": "application/json",
      "x-user-id": "1",
      "x-user-role": "ADMIN",
      "x-session-id": "sess-abc",
      "content-length": "10000",
    })
    const req = new NextRequest(new URL("http://test.local/api/auth/mfa/step-up"), {
      method: "POST",
      headers,
      body: JSON.stringify({ otp: "123456" }),
    })
    const res = await POST(req)
    expect(res.status).toBe(413)
  })
})
