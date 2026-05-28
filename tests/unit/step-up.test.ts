/**
 * Tests pour `src/lib/auth/step-up.ts` (Plan B follow-up A2).
 *
 * Couvre :
 *   - `checkFreshMfa` retourne `stepUpRequired` si sessionId absent
 *   - `mfaEnrollmentRequired` si user.mfaEnabled = false
 *   - `stepUpRequired` si mfaLastVerifiedAt = null
 *   - `stepUpRequired` si mfaLastVerifiedAt > 5 min
 *   - `ok: true` si mfaLastVerifiedAt < 5 min
 *   - `requireFreshMfa` throw `StepUpRequiredError`
 *   - `stepUpErrorResponse` retourne 401 + WWW-Authenticate stepup
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db/client", () => ({
  prisma: {
    session: { findFirst: vi.fn() },
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

import { prisma } from "@/lib/db/client"
import { auditService } from "@/lib/services/audit.service"
import {
  STEP_UP_WINDOW_SECONDS,
  checkFreshMfa,
  requireFreshMfa,
  stepUpErrorResponse,
  StepUpRequiredError,
} from "@/lib/auth/step-up"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("checkFreshMfa", () => {
  const userId = 42
  const sessionId = "sess-abc"

  it("sessionId absent → stepUpRequired (legacy JWT sans sid)", async () => {
    const result = await checkFreshMfa(userId, undefined)
    expect(result).toEqual({ ok: false, reason: "stepUpRequired" })
    expect(prisma.session.findFirst).not.toHaveBeenCalled()
  })

  it("session not found → stepUpRequired (révoquée ou cross-user spoof)", async () => {
    vi.mocked(prisma.session.findFirst).mockResolvedValue(null)
    const result = await checkFreshMfa(userId, sessionId)
    expect(result).toEqual({ ok: false, reason: "stepUpRequired" })
  })

  it("user.mfaEnabled = false → mfaEnrollmentRequired", async () => {
    vi.mocked(prisma.session.findFirst).mockResolvedValue({
      mfaLastVerifiedAt: null,
      user: { mfaEnabled: false },
    } as never)
    const result = await checkFreshMfa(userId, sessionId)
    expect(result).toEqual({ ok: false, reason: "mfaEnrollmentRequired" })
  })

  it("mfaLastVerifiedAt = null mais mfaEnabled = true → stepUpRequired", async () => {
    vi.mocked(prisma.session.findFirst).mockResolvedValue({
      mfaLastVerifiedAt: null,
      user: { mfaEnabled: true },
    } as never)
    const result = await checkFreshMfa(userId, sessionId)
    expect(result).toEqual({ ok: false, reason: "stepUpRequired" })
  })

  it("mfaLastVerifiedAt > 5 min → stepUpRequired", async () => {
    const stale = new Date(Date.now() - (STEP_UP_WINDOW_SECONDS + 10) * 1000)
    vi.mocked(prisma.session.findFirst).mockResolvedValue({
      mfaLastVerifiedAt: stale,
      user: { mfaEnabled: true },
    } as never)
    const result = await checkFreshMfa(userId, sessionId)
    expect(result).toEqual({ ok: false, reason: "stepUpRequired" })
  })

  it("mfaLastVerifiedAt < 5 min → ok", async () => {
    const fresh = new Date(Date.now() - 60_000) // 1 min ago
    vi.mocked(prisma.session.findFirst).mockResolvedValue({
      mfaLastVerifiedAt: fresh,
      user: { mfaEnabled: true },
    } as never)
    const result = await checkFreshMfa(userId, sessionId)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.verifiedAt).toEqual(fresh)
  })

  it("scope per-user — findFirst inclut userId dans le where", async () => {
    vi.mocked(prisma.session.findFirst).mockResolvedValue(null)
    await checkFreshMfa(userId, sessionId)
    expect(prisma.session.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: sessionId, userId },
      }),
    )
  })
})

describe("requireFreshMfa", () => {
  it("throw StepUpRequiredError si pas fresh", async () => {
    vi.mocked(prisma.session.findFirst).mockResolvedValue(null)
    await expect(requireFreshMfa(42, "sess-x")).rejects.toThrow(StepUpRequiredError)
    await expect(requireFreshMfa(42, "sess-x")).rejects.toMatchObject({
      reason: "stepUpRequired",
    })
  })

  it("retourne verifiedAt si fresh", async () => {
    const fresh = new Date(Date.now() - 30_000)
    vi.mocked(prisma.session.findFirst).mockResolvedValue({
      mfaLastVerifiedAt: fresh,
      user: { mfaEnabled: true },
    } as never)
    const result = await requireFreshMfa(42, "sess-x")
    expect(result).toEqual(fresh)
  })
})

describe("stepUpErrorResponse", () => {
  const ctx = {
    ipAddress: "1.2.3.4",
    userAgent: "ua",
    requestId: "req-id",
  }

  it("retourne 401 + WWW-Authenticate stepup + ANSSI no-store", async () => {
    const res = await stepUpErrorResponse(
      "stepUpRequired",
      42,
      "sess-x",
      ctx,
      { route: "admin/users/[id] PATCH" },
    )
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe("stepUpRequired")
    expect(res.headers.get("WWW-Authenticate")).toBe(
      `stepup reason="stepUpRequired", realm="diabeo"`,
    )
    expect(res.headers.get("Cache-Control")).toContain("no-store")
    expect(res.headers.get("Pragma")).toBe("no-cache")
  })

  it("audit MFA_STEP_UP_REQUIRED appelé avec route metadata", async () => {
    await stepUpErrorResponse(
      "mfaEnrollmentRequired",
      42,
      "sess-x",
      ctx,
      { route: "admin/users/[id] PATCH" },
    )
    expect(auditService.log).toHaveBeenCalledTimes(1)
    expect(vi.mocked(auditService.log).mock.calls[0]?.[0]).toMatchObject({
      userId: 42,
      action: "MFA_STEP_UP_REQUIRED",
      resource: "SESSION",
      resourceId: "sess-x",
      metadata: {
        route: "admin/users/[id] PATCH",
        reason: "mfaEnrollmentRequired",
      },
    })
  })

  it("audit fail → response 401 quand-même retournée", async () => {
    vi.mocked(auditService.log).mockRejectedValueOnce(new Error("DB down"))
    const res = await stepUpErrorResponse(
      "stepUpRequired",
      42,
      "sess-x",
      ctx,
      { route: "x" },
    )
    expect(res.status).toBe(401)
  })
})
