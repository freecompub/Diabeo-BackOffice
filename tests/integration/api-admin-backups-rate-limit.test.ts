/**
 * @description A4 round 2 — Integration tests rate-limit + burst US-2265
 * sur `POST /api/admin/backups` (43 findings résolus).
 *
 * Round 2 couvre :
 *   - C-1 : IP "unknown" composite bucket (anti-collapse)
 *   - C-2 : auditService.rateLimited câble burst US-2265
 *   - C-3 : caps 3/h user + 6/h IP (aligned PHI sensitivity)
 *   - C-4 : degraded propagated metadata
 *   - H-1 : Promise.all both checks unconditional
 *   - H-2 : audit throw → logger.warn (not silent)
 *   - H-3 : 401 ordering freeze (no rate-limit call)
 *   - H-5 : Retry-After ≥ 1
 *   - H-6 : 409 still consumes budget (runbook §3.3 fix)
 *   - H-7 : userAgent propagated
 *   - H-8 : requestId propagated
 *   - H-9 : audit throw → 429 still returned
 *   - M-1 : ANSSI headers on 429
 *   - M-2 : X-RateLimit-* headers on 202
 *   - M-10 : anti-regression failMode "closed"
 *   - M-11 : both-fail combination
 *   - M-12 : 500 path on unexpected error
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/db/client", () => ({ prisma: {} }))

vi.mock("@/lib/services/backup.service", () => ({
  backupService: {
    trigger: vi.fn(),
  },
}))

vi.mock("@/lib/auth/api-rate-limit", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth/api-rate-limit")>()
  return {
    ...actual,
    checkApiRateLimit: vi.fn(),
  }
})

vi.mock("@/lib/services/audit.service", async (orig) => {
  const actual = await orig<typeof import("@/lib/services/audit.service")>()
  return {
    ...actual,
    auditService: {
      ...actual.auditService,
      log: vi.fn().mockResolvedValue({}),
      accessDenied: vi.fn().mockResolvedValue({}),
      rateLimited: vi.fn().mockResolvedValue({ rateLimitedRow: {}, burstRow: null }),
    },
  }
})

import { backupService } from "@/lib/services/backup.service"
import { auditService } from "@/lib/services/audit.service"
import { checkApiRateLimit, RATE_LIMITS } from "@/lib/auth/api-rate-limit"
import { logger } from "@/lib/logger"

const { POST } = await import("@/app/api/admin/backups/route")

function makeReq(init: {
  auth?: boolean
  ip?: string
  userAgent?: string
  requestId?: string
} = {}): NextRequest {
  const headers = new Headers()
  if (init.auth !== false) {
    headers.set("x-user-id", "1")
    headers.set("x-user-role", "ADMIN")
    headers.set("x-session-id", "sess-abc")
  }
  if (init.ip) headers.set("x-forwarded-for", init.ip)
  if (init.userAgent) headers.set("user-agent", init.userAgent)
  if (init.requestId) headers.set("x-request-id", init.requestId)
  return new NextRequest(new URL("http://test.local/api/admin/backups"), {
    method: "POST",
    headers,
  })
}

const allowed = {
  allowed: true,
  remaining: 2,
  retryAfterSec: 3600,
}
const blocked = {
  allowed: false,
  remaining: 0,
  retryAfterSec: 1234,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(checkApiRateLimit).mockImplementation(async () => allowed)
})

describe("POST /api/admin/backups — A4 rate-limit (round 1)", () => {
  it("401 sans JWT — H-3 ordering freeze : checkApiRateLimit NON appelé", async () => {
    const res = await POST(makeReq({ auth: false }))
    expect(res.status).toBe(401)
    // H-3 — ordering freeze : ne consomme pas le bucket
    expect(checkApiRateLimit).not.toHaveBeenCalled()
    expect(auditService.rateLimited).not.toHaveBeenCalled()
  })

  it("202 OK 1er appel + X-RateLimit-* headers + checkApiRateLimit×2 unconditional", async () => {
    vi.mocked(backupService.trigger).mockResolvedValue({
      id: 1, backupRef: "uuid-1", status: "pending",
    } as never)
    const res = await POST(makeReq({ ip: "1.2.3.4" }))
    expect(res.status).toBe(202)
    expect(backupService.trigger).toHaveBeenCalledOnce()
    // H-1 — Promise.all both checks unconditional
    expect(checkApiRateLimit).toHaveBeenCalledTimes(2)
    // M-2 — X-RateLimit-* headers RFC 6585
    expect(res.headers.get("X-RateLimit-Limit-User")).toBe("3")
    expect(res.headers.get("X-RateLimit-Limit-Ip")).toBe("6")
    expect(res.headers.get("X-RateLimit-Remaining")).toBeTruthy()
    expect(res.headers.get("X-RateLimit-Reset")).toBeTruthy()
  })

  it("429 per-user (1er fail) + audit.rateLimited scope=user + ANSSI headers", async () => {
    vi.mocked(checkApiRateLimit)
      .mockResolvedValueOnce(blocked)
      .mockResolvedValueOnce(allowed)
    const res = await POST(makeReq({ ip: "1.2.3.4" }))
    expect(res.status).toBe(429)
    expect(res.headers.get("Retry-After")).toBe("1234")
    // M-1 — ANSSI headers
    expect(res.headers.get("Cache-Control")).toContain("no-store")
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff")
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer")
    expect(backupService.trigger).not.toHaveBeenCalled()
    // C-2 — burst-aware audit (vs ancien auditService.log direct)
    expect(auditService.rateLimited).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: "BACKUP",
        metadata: expect.objectContaining({
          scope: "user",
          bucket: "admin-backup-trigger",
        }),
      }),
    )
    // H-1 — both checks ran (Promise.all unconditional)
    expect(checkApiRateLimit).toHaveBeenCalledTimes(2)
  })

  it("M-11 both-fail — user AND IP fail → audit emits TWICE (scope=user + scope=ip)", async () => {
    vi.mocked(checkApiRateLimit)
      .mockResolvedValueOnce(blocked)
      .mockResolvedValueOnce(blocked)
    const res = await POST(makeReq({ ip: "1.2.3.4" }))
    expect(res.status).toBe(429)
    // H-1 — les 2 audits émis (user + IP)
    expect(auditService.rateLimited).toHaveBeenCalledTimes(2)
    const scopes = vi.mocked(auditService.rateLimited).mock.calls.map(
      (c) => (c[0].metadata as Record<string, unknown>).scope,
    )
    expect(scopes).toEqual(["user", "ip"])
  })

  it("429 per-IP (per-user OK + per-IP fail) + scope=ip audit", async () => {
    vi.mocked(checkApiRateLimit)
      .mockResolvedValueOnce(allowed)
      .mockResolvedValueOnce(blocked)
    const res = await POST(makeReq({ ip: "1.2.3.4" }))
    expect(res.status).toBe(429)
    expect(backupService.trigger).not.toHaveBeenCalled()
    expect(auditService.rateLimited).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          scope: "ip",
          bucket: "admin-backup-trigger-ip",
        }),
      }),
    )
  })

  it("H-6 — 409 backup_already_in_progress consomme le budget rate-limit", async () => {
    vi.mocked(backupService.trigger).mockRejectedValue(
      new Error("backup_already_in_progress"),
    )
    const res = await POST(makeReq({ ip: "1.2.3.4" }))
    expect(res.status).toBe(409)
    // H-6 — les 2 checks ont consommé Redis INCR avant le throw
    expect(checkApiRateLimit).toHaveBeenCalledTimes(2)
    // PAS d'audit RATE_LIMITED (allowed=true sur les 2)
    expect(auditService.rateLimited).not.toHaveBeenCalled()
  })
})

describe("A4 round 2 — Critical fixes", () => {
  it("C-1 — ipAddress='unknown' → composite 'unknown:<userId>' + logger.warn", async () => {
    vi.mocked(backupService.trigger).mockResolvedValue({} as never)
    const warnSpy = vi.spyOn(logger, "warn")
    // makeReq sans `ip` → ipAddress="unknown" fallback
    await POST(makeReq())
    // 2e checkApiRateLimit call utilise composite "unknown:1"
    const ipCall = vi.mocked(checkApiRateLimit).mock.calls[1]
    expect(ipCall?.[0]).toBe("unknown:1")
    // logger.warn signal pour ops
    expect(warnSpy).toHaveBeenCalledWith(
      "api",
      expect.stringContaining("ipAddress=unknown"),
      expect.objectContaining({
        kind: "rate-limit.ip.unknown",
        userId: 1,
      }),
    )
    warnSpy.mockRestore()
  })

  it("C-4 — degraded propagated in audit metadata (Redis outage signal)", async () => {
    vi.mocked(checkApiRateLimit).mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      retryAfterSec: 3600,
      degraded: true,
    })
    vi.mocked(checkApiRateLimit).mockResolvedValueOnce(allowed)
    await POST(makeReq({ ip: "1.2.3.4" }))
    expect(auditService.rateLimited).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          degraded: true, // C-4 — SOC peut trier infra vs attaque
        }),
      }),
    )
  })

  it("H-5 — Retry-After ≥ 1 (jamais 0 ni négatif)", async () => {
    vi.mocked(checkApiRateLimit).mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      retryAfterSec: 0, // edge case fallback in-memory
    })
    vi.mocked(checkApiRateLimit).mockResolvedValueOnce(allowed)
    const res = await POST(makeReq({ ip: "1.2.3.4" }))
    expect(res.status).toBe(429)
    const retryAfter = Number(res.headers.get("Retry-After"))
    expect(retryAfter).toBeGreaterThanOrEqual(1)
  })
})

describe("A4 round 2 — Forensique audit propagation", () => {
  it("H-7 — userAgent propagé en audit RATE_LIMITED", async () => {
    vi.mocked(checkApiRateLimit)
      .mockResolvedValueOnce(blocked)
      .mockResolvedValueOnce(allowed)
    await POST(makeReq({
      ip: "1.2.3.4",
      userAgent: "Mozilla/5.0 (test)",
    }))
    expect(auditService.rateLimited).toHaveBeenCalledWith(
      expect.objectContaining({
        userAgent: "Mozilla/5.0 (test)",
      }),
    )
  })

  it("H-8 — requestId propagé en audit + outer catch log", async () => {
    vi.mocked(checkApiRateLimit)
      .mockResolvedValueOnce(blocked)
      .mockResolvedValueOnce(allowed)
    await POST(makeReq({
      ip: "1.2.3.4",
      requestId: "rid-test-abc",
    }))
    expect(auditService.rateLimited).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "rid-test-abc",
      }),
    )
  })

  it("H-7 — ipAddress réel propagé en audit (top-level field)", async () => {
    vi.mocked(checkApiRateLimit)
      .mockResolvedValueOnce(allowed)
      .mockResolvedValueOnce(blocked)
    await POST(makeReq({ ip: "5.6.7.8" }))
    expect(auditService.rateLimited).toHaveBeenCalledWith(
      expect.objectContaining({
        ipAddress: "5.6.7.8",
      }),
    )
  })
})

describe("A4 round 2 — Resilience", () => {
  it("H-2 / H-9 — audit throw → logger.warn + 429 quand-même retourné", async () => {
    vi.mocked(checkApiRateLimit)
      .mockResolvedValueOnce(blocked)
      .mockResolvedValueOnce(allowed)
    vi.mocked(auditService.rateLimited).mockRejectedValueOnce(
      new Error("DB audit down"),
    )
    const warnSpy = vi.spyOn(logger, "warn")
    const res = await POST(makeReq({ ip: "1.2.3.4" }))
    // H-9 — response 429 quand-même retournée
    expect(res.status).toBe(429)
    // H-2 — logger.warn appelé (vs ancien catch silent)
    expect(warnSpy).toHaveBeenCalledWith(
      "api",
      "audit RATE_LIMITED persist failed",
      expect.objectContaining({
        kind: "audit.rate_limited.persist_failed",
      }),
    )
    warnSpy.mockRestore()
  })

  it("M-12 — backupService.trigger throw non-mappé → 500 serverError", async () => {
    vi.mocked(backupService.trigger).mockRejectedValue(
      new Error("s3_upload_failed_unexpected"),
    )
    const res = await POST(makeReq({ ip: "1.2.3.4" }))
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe("serverError")
    // CLAUDE.md — pas de stack trace dans le body
    expect(json).not.toHaveProperty("stack")
    expect(JSON.stringify(json)).not.toContain("s3_upload_failed_unexpected")
  })
})

describe("A4 round 2 — Anti-régression preset config", () => {
  it("M-10 — adminBackupTrigger reste failMode='closed' max=3", () => {
    expect(RATE_LIMITS.adminBackupTrigger.failMode).toBe("closed")
    expect(RATE_LIMITS.adminBackupTrigger.max).toBe(3)
    expect(RATE_LIMITS.adminBackupTrigger.windowSec).toBe(3600)
  })

  it("M-10 — adminBackupTriggerIp reste failMode='closed' max=6", () => {
    expect(RATE_LIMITS.adminBackupTriggerIp.failMode).toBe("closed")
    expect(RATE_LIMITS.adminBackupTriggerIp.max).toBe(6)
    expect(RATE_LIMITS.adminBackupTriggerIp.windowSec).toBe(3600)
  })

  it("M-5 — bucket names cohérents (ADMIN_BACKUP_BUCKET_BASE + '-ip')", () => {
    expect(RATE_LIMITS.adminBackupTrigger.bucket).toBe("admin-backup-trigger")
    expect(RATE_LIMITS.adminBackupTriggerIp.bucket).toBe("admin-backup-trigger-ip")
  })
})
