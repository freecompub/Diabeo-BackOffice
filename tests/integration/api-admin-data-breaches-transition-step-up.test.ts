/**
 * A2 round 2 H-T2 (CRITICAL) — Integration tests step-up MFA wired sur
 * `POST /api/admin/data-breaches/[id]/transition` (FSM CNIL notif).
 *
 * Fenêtre durcie 1 min (`STEP_UP_WINDOW_SECONDS_CRITICAL`) car la notif
 * CNIL est externe + irréversible (RGPD Art. 33). Test critique : un
 * refactor qui passe la fenêtre à 5 min serait une régression réglementaire.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { DataBreachStatus } from "@prisma/client"

vi.mock("@/lib/db/client", () => ({
  prisma: {
    session: { findFirst: vi.fn() },
  },
}))

vi.mock("@/lib/services/data-breach.service", () => ({
  dataBreachService: {
    transition: vi.fn(),
  },
  DataBreachValidationError: class extends Error {},
  DataBreachNotFoundError: class extends Error {},
  DataBreachStateError: class extends Error {},
}))

vi.mock("@/lib/services/audit.service", async (orig) => {
  const actual = await orig<typeof import("@/lib/services/audit.service")>()
  return {
    ...actual,
    auditService: {
      ...actual.auditService,
      log: vi.fn().mockResolvedValue({}),
      accessDenied: vi.fn().mockResolvedValue({}),
      requireStepUp: vi.fn().mockResolvedValue({ stepUpRow: {}, burstRow: null }),
    },
  }
})

vi.mock("@/lib/team-route-helpers", async (orig) => {
  const actual = await orig<typeof import("@/lib/team-route-helpers")>()
  return {
    ...actual,
    auditedRequireRole: vi.fn().mockResolvedValue({
      id: 1,
      role: "ADMIN",
      sessionId: "sess-abc",
    }),
  }
})

import { prisma } from "@/lib/db/client"
import { dataBreachService } from "@/lib/services/data-breach.service"
import { auditService } from "@/lib/services/audit.service"
import { STEP_UP_WINDOW_SECONDS_CRITICAL } from "@/lib/auth/step-up"

const { POST } = await import("@/app/api/admin/data-breaches/[id]/transition/route")

function makeReq(body: unknown): NextRequest {
  const headers = new Headers({
    "content-type": "application/json",
    "x-user-id": "1",
    "x-user-role": "ADMIN",
    "x-session-id": "sess-abc",
  })
  return new NextRequest(new URL("http://test.local/api/admin/data-breaches/7/transition"), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("POST /api/admin/data-breaches/[id]/transition — Step-up MFA gate (H-4 CRITICAL window)", () => {
  it("Window CRITICAL (60s) — 90s ago = stepUpRequired (bloque FSM)", async () => {
    vi.mocked(prisma.session.findFirst).mockResolvedValue({
      mfaLastVerifiedAt: new Date(Date.now() - 90_000),
      user: { mfaEnabled: true },
    } as never)

    const res = await POST(
      makeReq({ to: DataBreachStatus.notified_cnil }),
      { params: Promise.resolve({ id: "7" }) },
    )
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe("stepUpRequired")
    expect(res.headers.get("WWW-Authenticate")).toContain("stepup")

    // Handler PAS appelé — la transition CNIL n'a PAS été déclenchée.
    expect(dataBreachService.transition).not.toHaveBeenCalled()

    // Audit MFA_STEP_UP_REQUIRED via requireStepUp burst US-2265
    expect(auditService.requireStepUp).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          route: "admin/data-breaches/[id]/transition POST",
          reason: "stepUpRequired",
        }),
      }),
    )
  })

  it("Window CRITICAL (60s) — 30s ago = fresh → handler exécute", async () => {
    vi.mocked(prisma.session.findFirst).mockResolvedValue({
      mfaLastVerifiedAt: new Date(Date.now() - 30_000),
      user: { mfaEnabled: true },
    } as never)
    vi.mocked(dataBreachService.transition).mockResolvedValue({
      id: 7,
      status: "notified_cnil",
    } as never)

    const res = await POST(
      makeReq({ to: DataBreachStatus.notified_cnil }),
      { params: Promise.resolve({ id: "7" }) },
    )
    expect(res.status).toBe(200)
    expect(dataBreachService.transition).toHaveBeenCalledOnce()
  })

  it("mfaEnabled=false → 401 mfaEnrollmentRequired (priorité enrollment)", async () => {
    vi.mocked(prisma.session.findFirst).mockResolvedValue({
      mfaLastVerifiedAt: new Date(Date.now() - 5_000),
      user: { mfaEnabled: false },
    } as never)

    const res = await POST(
      makeReq({ to: DataBreachStatus.notified_cnil }),
      { params: Promise.resolve({ id: "7" }) },
    )
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe("mfaEnrollmentRequired")
    expect(dataBreachService.transition).not.toHaveBeenCalled()
  })

  // Anti-régression — window default (5min) NE doit PAS être utilisé sur FSM.
  // Si un refactor remplace `STEP_UP_WINDOW_SECONDS_CRITICAL` par
  // `STEP_UP_WINDOW_SECONDS` par mégarde, ce test catch.
  it("anti-régression — 90s ago doit être stale (CRITICAL pas default)", async () => {
    expect(STEP_UP_WINDOW_SECONDS_CRITICAL).toBeLessThan(90)
    vi.mocked(prisma.session.findFirst).mockResolvedValue({
      mfaLastVerifiedAt: new Date(Date.now() - 90_000),
      user: { mfaEnabled: true },
    } as never)
    const res = await POST(
      makeReq({ to: DataBreachStatus.notified_cnil }),
      { params: Promise.resolve({ id: "7" }) },
    )
    expect(res.status).toBe(401)
  })
})
