/**
 * @description Plan B follow-up A2 — Integration tests step-up MFA wired
 * on `PATCH /api/admin/users/[id]`.
 *
 * Couvre :
 *   - Pas fresh MFA → 401 stepUpRequired + WWW-Authenticate
 *   - mfaEnabled=false → 401 mfaEnrollmentRequired
 *   - Fresh MFA (5min window) → handler exécute normalement
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/db/client", () => ({
  prisma: {
    session: { findFirst: vi.fn() },
  },
}))

vi.mock("@/lib/services/user-management.service", () => ({
  userManagementService: {
    updateRole: vi.fn(),
    setStatus: vi.fn(),
  },
}))

vi.mock("@/lib/services/audit.service", async (orig) => {
  const actual = await orig<typeof import("@/lib/services/audit.service")>()
  return {
    ...actual,
    auditService: {
      ...actual.auditService,
      log: vi.fn().mockResolvedValue({}),
      accessDenied: vi.fn().mockResolvedValue({}),
    },
  }
})

import { prisma } from "@/lib/db/client"
import { userManagementService } from "@/lib/services/user-management.service"
import { auditService } from "@/lib/services/audit.service"

const { PATCH } = await import("@/app/api/admin/users/[id]/route")

function makeReq(body: unknown, init: { sid?: string | null } = {}): NextRequest {
  const headers = new Headers({
    "content-type": "application/json",
    "x-user-id": "1",
    "x-user-role": "ADMIN",
  })
  if (init.sid !== null) headers.set("x-session-id", init.sid ?? "sess-abc")
  return new NextRequest(new URL("http://test.local/api/admin/users/42"), {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("PATCH /api/admin/users/[id] — Step-up MFA gate", () => {
  it("pas fresh (mfaLastVerifiedAt > 5min) → 401 stepUpRequired + WWW-Authenticate", async () => {
    vi.mocked(prisma.session.findFirst).mockResolvedValue({
      mfaLastVerifiedAt: new Date(Date.now() - 10 * 60_000), // 10 min ago
      user: { mfaEnabled: true },
    } as never)

    const res = await PATCH(makeReq({ role: "DOCTOR" }), {
      params: Promise.resolve({ id: "42" }),
    })
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe("stepUpRequired")
    expect(res.headers.get("WWW-Authenticate")).toContain("stepup")
    expect(res.headers.get("WWW-Authenticate")).toContain(`reason="stepUpRequired"`)
    expect(res.headers.get("Cache-Control")).toContain("no-store")

    // Handler PAS appelé
    expect(userManagementService.updateRole).not.toHaveBeenCalled()

    // Audit MFA_STEP_UP_REQUIRED
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "MFA_STEP_UP_REQUIRED",
        metadata: expect.objectContaining({
          route: "admin/users/[id] PATCH",
          reason: "stepUpRequired",
        }),
      }),
    )
  })

  it("mfaEnabled=false → 401 mfaEnrollmentRequired", async () => {
    vi.mocked(prisma.session.findFirst).mockResolvedValue({
      mfaLastVerifiedAt: null,
      user: { mfaEnabled: false },
    } as never)

    const res = await PATCH(makeReq({ role: "DOCTOR" }), {
      params: Promise.resolve({ id: "42" }),
    })
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe("mfaEnrollmentRequired")
    expect(res.headers.get("WWW-Authenticate")).toContain(`reason="mfaEnrollmentRequired"`)
  })

  it("session sans sid (legacy JWT) → 401 stepUpRequired", async () => {
    const res = await PATCH(makeReq({ role: "DOCTOR" }, { sid: null }), {
      params: Promise.resolve({ id: "42" }),
    })
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe("stepUpRequired")
    expect(prisma.session.findFirst).not.toHaveBeenCalled()
  })

  it("fresh MFA (< 5 min) → handler exécute normalement", async () => {
    vi.mocked(prisma.session.findFirst).mockResolvedValue({
      mfaLastVerifiedAt: new Date(Date.now() - 60_000), // 1 min ago
      user: { mfaEnabled: true },
    } as never)
    vi.mocked(userManagementService.updateRole).mockResolvedValue({
      id: 42,
      role: "DOCTOR",
    } as never)

    const res = await PATCH(makeReq({ role: "DOCTOR" }), {
      params: Promise.resolve({ id: "42" }),
    })
    expect(res.status).toBe(200)
    expect(userManagementService.updateRole).toHaveBeenCalledOnce()
  })
})
