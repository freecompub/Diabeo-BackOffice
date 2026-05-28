/**
 * @description Plan B follow-up A1 — Integration tests `withIdempotency`
 * wrapper sur PATCH `/api/admin/users/[id]`.
 *
 * Couvre les 4 scénarios principaux :
 *   1. Pas de header → handler exécute (rétro-compat)
 *   2. Header invalide → 400 `invalidIdempotencyKey` (avant handler)
 *   3. Replay valide → response cachée + header `X-Idempotency-Replayed: true`
 *   4. Mismatch (même key, body différent) → 409 `idempotencyMismatch`
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/db/client", () => ({ prisma: {} }))

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

import { userManagementService } from "@/lib/services/user-management.service"
import { idempotencyService } from "@/lib/idempotency/service"

const { PATCH } = await import("@/app/api/admin/users/[id]/route")

function makeReq(
  body: unknown,
  init: { idemKey?: string | null; userId?: string } = {},
): NextRequest {
  const headers = new Headers({
    "content-type": "application/json",
    "x-user-id": init.userId ?? "1",
    "x-user-role": "ADMIN",
  })
  if (init.idemKey !== null && init.idemKey !== undefined) {
    headers.set("idempotency-key", init.idemKey)
  }
  return new NextRequest(new URL("http://test.local/api/admin/users/42"), {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  })
}

const validUuid = "a3f9b8c2-4d56-4e89-8f12-345678abcdef"

beforeEach(() => {
  vi.clearAllMocks()
  idempotencyService.__resetMemoryForTests()
})

describe("PATCH /api/admin/users/[id] — Idempotency-Key", () => {
  it("pas de header → handler exécute normalement (rétro-compat)", async () => {
    vi.mocked(userManagementService.updateRole).mockResolvedValue({
      id: 42, role: "DOCTOR",
    } as any)
    const res = await PATCH(makeReq({ role: "DOCTOR" }, { idemKey: null }), {
      params: Promise.resolve({ id: "42" }),
    })
    expect(res.status).toBe(200)
    expect(userManagementService.updateRole).toHaveBeenCalledOnce()
    expect(res.headers.get("X-Idempotency-Replayed")).toBeNull()
  })

  it("header invalide (pas UUID v4) → 400 invalidIdempotencyKey", async () => {
    const res = await PATCH(
      makeReq({ role: "DOCTOR" }, { idemKey: "not-a-uuid" }),
      { params: Promise.resolve({ id: "42" }) },
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe("invalidIdempotencyKey")
    expect(userManagementService.updateRole).not.toHaveBeenCalled()
  })

  it("premier appel cache la response, replay même body → cached + header replayed=true", async () => {
    vi.mocked(userManagementService.updateRole).mockResolvedValue({
      id: 42, role: "DOCTOR",
    } as any)
    // 1er appel
    const res1 = await PATCH(
      makeReq({ role: "DOCTOR" }, { idemKey: validUuid }),
      { params: Promise.resolve({ id: "42" }) },
    )
    expect(res1.status).toBe(200)
    expect(userManagementService.updateRole).toHaveBeenCalledTimes(1)

    // 2e appel même key + même body → cached, handler PAS ré-appelé
    const res2 = await PATCH(
      makeReq({ role: "DOCTOR" }, { idemKey: validUuid }),
      { params: Promise.resolve({ id: "42" }) },
    )
    expect(res2.status).toBe(200)
    expect(res2.headers.get("X-Idempotency-Replayed")).toBe("true")
    // Handler n'a PAS été ré-exécuté → side-effect prévenu (audit, JWT revoke).
    expect(userManagementService.updateRole).toHaveBeenCalledTimes(1)
    const json2 = await res2.json()
    expect(json2.role).toBe("DOCTOR")
  })

  it("replay même key + body DIFFÉRENT → 409 idempotencyMismatch", async () => {
    vi.mocked(userManagementService.updateRole).mockResolvedValue({
      id: 42, role: "DOCTOR",
    } as any)
    // 1er appel
    await PATCH(
      makeReq({ role: "DOCTOR" }, { idemKey: validUuid }),
      { params: Promise.resolve({ id: "42" }) },
    )
    // 2e appel : même key, body différent (ADMIN au lieu de DOCTOR)
    const res = await PATCH(
      makeReq({ role: "ADMIN" }, { idemKey: validUuid }),
      { params: Promise.resolve({ id: "42" }) },
    )
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toBe("idempotencyMismatch")
    // Handler PAS ré-appelé → empêche un client buggé d'écraser le role.
    expect(userManagementService.updateRole).toHaveBeenCalledTimes(1)
  })

  it("scope par user — user A cache, user B même key → handler ré-exécute", async () => {
    vi.mocked(userManagementService.updateRole).mockResolvedValue({
      id: 42, role: "DOCTOR",
    } as any)
    // User 1 PATCH
    await PATCH(
      makeReq({ role: "DOCTOR" }, { idemKey: validUuid, userId: "1" }),
      { params: Promise.resolve({ id: "42" }) },
    )
    // User 2 PATCH même key, même body → miss (scope per-user) → handler ré-appelé
    await PATCH(
      makeReq({ role: "DOCTOR" }, { idemKey: validUuid, userId: "2" }),
      { params: Promise.resolve({ id: "42" }) },
    )
    expect(userManagementService.updateRole).toHaveBeenCalledTimes(2)
  })
})
