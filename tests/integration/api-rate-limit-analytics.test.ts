/**
 * Test suite: Rate-limited analytics route — 429 response path
 *
 * Clinical behavior tested:
 * - /api/analytics/time-in-range enforces the per-user quota from RATE_LIMITS.analytics
 *   (30 req/60 s): the 31st request within the window returns HTTP 429 with a
 *   Retry-After header so SPA clients can back off gracefully
 * - The rate-limit check runs before GDPR consent and patient resolution, so a
 *   burst of unauthorized calls cannot bypass the budget via validation errors
 *
 * Associated risks:
 * - A missing 429 path would let a single authenticated user DoS the analytics
 *   service (analytics jobs scan CGM/bolus windows and are DB-expensive)
 * - A wrong Retry-After header would cause infinite retry loops from the UI
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

// Force in-memory rate-limit fallback.
vi.stubEnv("UPSTASH_REDIS_REST_URL", "")
vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "")

vi.mock("@/lib/db/client", () => ({
  prisma: {
    patient: { findFirst: vi.fn().mockResolvedValue({ id: 42 }) },
    userPrivacySettings: {
      findUnique: vi.fn().mockResolvedValue({ gdprConsent: true }),
    },
  },
}))

vi.mock("@/lib/gdpr", () => ({
  requireGdprConsent: vi.fn().mockResolvedValue(true),
}))

vi.mock("@/lib/services/analytics.service", () => ({
  analyticsService: {
    timeInRange: vi.fn().mockResolvedValue({ low: 10, ok: 80, high: 10 }),
  },
}))

vi.mock("@/lib/services/audit.service", () => ({
  auditService: { log: vi.fn().mockResolvedValue({}) },
  extractRequestContext: () => ({ ipAddress: "127.0.0.1", userAgent: "vitest" }),
}))

const { GET } = await import("@/app/api/analytics/time-in-range/route")

function req(patientId?: string): NextRequest {
  const url = new URL("http://localhost:3000/api/analytics/time-in-range?period=7d")
  if (patientId) url.searchParams.set("patientId", patientId)
  return new NextRequest(url, {
    method: "GET",
    headers: { "x-user-id": "1", "x-user-role": "VIEWER", "user-agent": "vitest" },
  })
}

describe("GET /api/analytics/time-in-range — rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("allows the first 30 requests and blocks the 31st with 429 + Retry-After", async () => {
    let lastAllowed: Response | undefined
    for (let i = 0; i < 30; i++) {
      lastAllowed = await GET(req())
    }
    expect(lastAllowed?.status).toBe(200)

    const blocked = await GET(req())
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get("Retry-After")).toMatch(/^\d+$/)
    const body = await blocked.json()
    expect(body.error).toBe("rateLimitExceeded")
  })
})
