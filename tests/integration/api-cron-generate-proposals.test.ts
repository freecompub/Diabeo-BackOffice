/**
 * @description US-2651 — Cron route générateur de propositions : tests d'intégration.
 *
 * Couvre : auth Bearer CRON_SECRET (timing-safe), 503 sans secret, 401 sans/mauvais Bearer,
 * 200 + métriques, GET NON exporté (POST-only anti-leak), audit `cron.auth.failed`, headers ANSSI, ctx audit propagé.
 */
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/db/client", () => ({ prisma: {} }))

vi.mock("@/lib/services/proposal-generator.service", () => ({
  proposalGeneratorService: {
    generateForAllPatients: vi.fn().mockResolvedValue({
      processed: 3, created: 2, errored: 0, skippedConcurrent: false,
    }),
  },
}))

vi.mock("@/lib/services/audit.service", async (orig) => {
  const actual = await orig<typeof import("@/lib/services/audit.service")>()
  return {
    ...actual,
    auditService: { ...actual.auditService, log: vi.fn().mockResolvedValue(undefined) },
  }
})

import { proposalGeneratorService } from "@/lib/services/proposal-generator.service"
import { auditService } from "@/lib/services/audit.service"
const routeModule = await import("@/app/api/cron/generate-proposals/route")
const { POST } = routeModule
// GET n'est plus exporté (POST-only) → accès via cast, `undefined` attendu (cf. test dédié).
const GET = (routeModule as Record<string, unknown>).GET

const VALID_SECRET = "test-cron-secret-32-bytes-long-aaa"

function makeReq(bearer?: string): NextRequest {
  const headers = new Headers()
  if (bearer !== undefined) headers.set("authorization", `Bearer ${bearer}`)
  return new NextRequest(new URL("/api/cron/generate-proposals", "http://test.local"), { method: "POST", headers })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = VALID_SECRET
})
afterEach(() => { delete process.env.CRON_SECRET })

describe("POST /api/cron/generate-proposals", () => {
  it("200 + métriques si Bearer correct", async () => {
    const res = await POST(makeReq(VALID_SECRET))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ processed: 3, created: 2, errored: 0, skippedConcurrent: false })
    expect(proposalGeneratorService.generateForAllPatients).toHaveBeenCalledTimes(1)
  })

  it("401 sans header authorization (générateur non appelé)", async () => {
    const res = await POST(makeReq())
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe("unauthorized")
    expect(proposalGeneratorService.generateForAllPatients).not.toHaveBeenCalled()
  })

  it("401 si Bearer incorrect + timing-safe (longueur différente ne crash pas)", async () => {
    expect((await POST(makeReq("wrong-secret"))).status).toBe(401)
    expect((await POST(makeReq("short"))).status).toBe(401)
  })

  it("503 si CRON_SECRET non configuré (defense-in-depth)", async () => {
    delete process.env.CRON_SECRET
    const res = await POST(makeReq(VALID_SECRET))
    expect(res.status).toBe(503)
    expect((await res.json()).error).toBe("cronDisabled")
  })

  it("GET NON exporté (POST-only, anti-leak du Bearer → 405 Next.js)", () => {
    // Durcissement US-2652 (aligné rappels round 2 H3) : un GET ferait fuiter CRON_SECRET dans les
    // access logs / Referer / cache CDN. `GET` n'est plus exporté → Next.js répond 405.
    expect(GET).toBeUndefined()
  })

  it("émet un audit cron.auth.failed (userId null) sur 401", async () => {
    await POST(makeReq("wrong-secret"))
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: null, action: "UNAUTHORIZED", resource: "ADJUSTMENT_PROPOSAL", resourceId: "cron",
        metadata: expect.objectContaining({ kind: "cron.auth.failed" }),
      }),
    )
  })

  it("headers ANSSI (no-store, no-referrer, nosniff) sur la réponse", async () => {
    const res = await POST(makeReq(VALID_SECRET))
    expect(res.headers.get("Cache-Control")).toContain("no-store")
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer")
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff")
  })

  it("le générateur reçoit le ctx audit (requestId)", async () => {
    await POST(makeReq(VALID_SECRET))
    const call = vi.mocked(proposalGeneratorService.generateForAllPatients).mock.calls[0]
    expect(call![0]).toHaveProperty("requestId")
  })
})
