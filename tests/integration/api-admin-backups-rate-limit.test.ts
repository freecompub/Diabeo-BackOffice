/**
 * @description Plan B follow-up A4 — Integration tests rate-limit sur
 * `POST /api/admin/backups`.
 *
 * Couvre :
 *   - 401 sans JWT
 *   - 202 OK 1er appel
 *   - 429 per-user après 5 calls (cap 5/h)
 *   - 429 per-IP même si per-user OK (sessions différentes)
 *   - Audit RATE_LIMITED métadata scope: user|ip
 *   - Retry-After header présent
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
    },
  }
})

import { backupService } from "@/lib/services/backup.service"
import { auditService } from "@/lib/services/audit.service"
import { checkApiRateLimit } from "@/lib/auth/api-rate-limit"

const { POST } = await import("@/app/api/admin/backups/route")

function makeReq(init: { auth?: boolean; ip?: string } = {}): NextRequest {
  const headers = new Headers()
  if (init.auth !== false) {
    headers.set("x-user-id", "1")
    headers.set("x-user-role", "ADMIN")
    headers.set("x-session-id", "sess-abc")
  }
  if (init.ip) headers.set("x-forwarded-for", init.ip)
  return new NextRequest(new URL("http://test.local/api/admin/backups"), {
    method: "POST",
    headers,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default : rate-limit allowed
  vi.mocked(checkApiRateLimit).mockResolvedValue({
    allowed: true,
    remaining: 4,
    retryAfterSec: 3600,
  })
})

describe("POST /api/admin/backups — A4 rate-limit", () => {
  it("401 sans JWT", async () => {
    const res = await POST(makeReq({ auth: false }))
    expect(res.status).toBe(401)
  })

  it("202 OK 1er appel — rate-limit allowed", async () => {
    vi.mocked(backupService.trigger).mockResolvedValue({
      id: 1, backupRef: "uuid-1", status: "pending",
    } as never)
    const res = await POST(makeReq())
    expect(res.status).toBe(202)
    expect(backupService.trigger).toHaveBeenCalledOnce()
    // checkApiRateLimit appelé 2 fois (per-user puis per-IP)
    expect(checkApiRateLimit).toHaveBeenCalledTimes(2)
  })

  it("429 per-user (1er check fail) + audit RATE_LIMITED metadata.scope=user", async () => {
    vi.mocked(checkApiRateLimit).mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      retryAfterSec: 1234,
    })
    const res = await POST(makeReq())
    expect(res.status).toBe(429)
    expect(res.headers.get("Retry-After")).toBe("1234")
    const json = await res.json()
    expect(json.error).toBe("rateLimitExceeded")
    // backupService PAS appelé
    expect(backupService.trigger).not.toHaveBeenCalled()
    // Audit RATE_LIMITED scope=user
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "RATE_LIMITED",
        resource: "BACKUP",
        metadata: expect.objectContaining({
          scope: "user",
          bucket: "admin-backup-trigger",
        }),
      }),
    )
    // Second check (per-IP) PAS atteint (short-circuit après per-user fail)
    expect(checkApiRateLimit).toHaveBeenCalledTimes(1)
  })

  it("429 per-IP (per-user OK + per-IP fail) + audit metadata.scope=ip", async () => {
    vi.mocked(checkApiRateLimit)
      .mockResolvedValueOnce({ allowed: true, remaining: 4, retryAfterSec: 3600 })
      .mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfterSec: 5678 })
    const res = await POST(makeReq({ ip: "1.2.3.4" }))
    expect(res.status).toBe(429)
    expect(res.headers.get("Retry-After")).toBe("5678")
    expect(backupService.trigger).not.toHaveBeenCalled()
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "RATE_LIMITED",
        resource: "BACKUP",
        metadata: expect.objectContaining({
          scope: "ip",
          bucket: "admin-backup-trigger-ip",
        }),
      }),
    )
    expect(checkApiRateLimit).toHaveBeenCalledTimes(2)
  })

  it("backup_already_in_progress 409 (service-level concurrency guard)", async () => {
    vi.mocked(backupService.trigger).mockRejectedValue(
      new Error("backup_already_in_progress"),
    )
    const res = await POST(makeReq())
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toBe("backup_already_in_progress")
  })
})
