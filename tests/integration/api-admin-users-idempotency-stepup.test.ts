/**
 * A2 round 2 C-1 (CRITICAL) — Integration test : le wrapper `withIdempotency`
 * NE doit PAS cacher les 401 step-up. Sans ce skip, un user qui fait
 * step-up + retry avec même Idempotency-Key recevrait la 401 cachée en
 * boucle (contrat runbook §3.3 cassé).
 *
 * Couvre :
 *   - 1er appel MFA stale → 401 stepUpRequired (NON-caché)
 *   - 2e appel même Idempotency-Key + MFA fresh → handler exécute, 200
 *   - 3e appel même Idempotency-Key + même body → replay 200 cached
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
      requireStepUp: vi.fn().mockResolvedValue({ stepUpRow: {}, burstRow: null }),
    },
  }
})

import { prisma } from "@/lib/db/client"
import { userManagementService } from "@/lib/services/user-management.service"
import { idempotencyService } from "@/lib/idempotency/service"
import { IDEMPOTENCY_REPLAYED_HEADER } from "@/lib/idempotency/with-idempotency"

const { PATCH } = await import("@/app/api/admin/users/[id]/route")

const validUuid = "a3f9b8c2-4d56-4e89-8f12-345678abcdef"

function makeReq(body: unknown): NextRequest {
  const headers = new Headers({
    "content-type": "application/json",
    "x-user-id": "1",
    "x-user-role": "ADMIN",
    "x-session-id": "sess-abc",
    "idempotency-key": validUuid,
  })
  return new NextRequest(new URL("http://test.local/api/admin/users/42"), {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  idempotencyService.__resetMemoryForTests()
  idempotencyService.__resetRedisClientForTests()
})

describe("C-1 — Idempotency-Key cache 401 step-up NE doit PAS être caché", () => {
  it("Scenario complet : MFA stale → 401 + step-up + retry → 200 + replay → 200 cached", async () => {
    // 1er appel : MFA stale (10 min ago)
    vi.mocked(prisma.session.findFirst).mockResolvedValue({
      mfaLastVerifiedAt: new Date(Date.now() - 10 * 60_000),
      user: { mfaEnabled: true },
    } as never)
    vi.mocked(userManagementService.updateRole).mockResolvedValue({
      id: 42, role: "DOCTOR",
    } as never)

    const res1 = await PATCH(
      makeReq({ role: "DOCTOR" }),
      { params: Promise.resolve({ id: "42" }) },
    )
    expect(res1.status).toBe(401)
    expect(res1.headers.get("WWW-Authenticate")).toContain("stepup")
    expect(userManagementService.updateRole).not.toHaveBeenCalled()

    // 2e appel : MFA fresh (user a fait step-up, retry même Idempotency-Key)
    vi.mocked(prisma.session.findFirst).mockResolvedValue({
      mfaLastVerifiedAt: new Date(Date.now() - 30_000),
      user: { mfaEnabled: true },
    } as never)

    const res2 = await PATCH(
      makeReq({ role: "DOCTOR" }),
      { params: Promise.resolve({ id: "42" }) },
    )
    // C-1 fix — le 401 step-up de res1 NE doit PAS avoir été caché, donc
    // res2 ré-exécute le handler avec MFA fresh → 200 succès.
    expect(res2.status).toBe(200)
    expect(res2.headers.get(IDEMPOTENCY_REPLAYED_HEADER)).toBeNull()
    expect(userManagementService.updateRole).toHaveBeenCalledOnce()

    // 3e appel même Idempotency-Key + même body → cette fois le 200 est cached
    const res3 = await PATCH(
      makeReq({ role: "DOCTOR" }),
      { params: Promise.resolve({ id: "42" }) },
    )
    expect(res3.status).toBe(200)
    expect(res3.headers.get(IDEMPOTENCY_REPLAYED_HEADER)).toBe("true")
    expect(userManagementService.updateRole).toHaveBeenCalledOnce() // toujours 1x
  })

  it("WWW-Authenticate: stepup header trigger le skip cache (peu importe la casse)", async () => {
    vi.mocked(prisma.session.findFirst).mockResolvedValue({
      mfaLastVerifiedAt: new Date(Date.now() - 10 * 60_000),
      user: { mfaEnabled: true },
    } as never)

    const res1 = await PATCH(
      makeReq({ role: "DOCTOR" }),
      { params: Promise.resolve({ id: "42" }) },
    )
    expect(res1.status).toBe(401)
    expect(res1.headers.get("WWW-Authenticate")?.toLowerCase()).toContain("stepup")
  })
})
