/**
 * @description US-2108 — Cron route integration tests.
 *
 * Couvre :
 *   - Auth Bearer CRON_SECRET (timing-safe equal).
 *   - 503 si CRON_SECRET non configure (defense-in-depth).
 *   - 401 si Bearer manquant / invalide.
 *   - 200 + metrics si OK.
 */
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/db/client", () => ({ prisma: {} }))

vi.mock("@/lib/services/invoice-reminder.service", () => ({
  invoiceReminderService: {
    processOverdueInvoices: vi.fn().mockResolvedValue({
      processed: 0, sent: 0, failed: 0, skipped: 0,
      byStep: {
        step_7: { sent: 0, failed: 0, skipped: 0 },
        step_15: { sent: 0, failed: 0, skipped: 0 },
        step_30: { sent: 0, failed: 0, skipped: 0 },
      },
    }),
  },
}))

vi.mock("@/lib/services/audit.service", async (orig) => {
  const actual = await orig<typeof import("@/lib/services/audit.service")>()
  return {
    ...actual,
    auditService: {
      ...actual.auditService,
      log: vi.fn().mockResolvedValue(undefined),
      accessDenied: vi.fn().mockResolvedValue(undefined),
    },
  }
})

import { invoiceReminderService } from "@/lib/services/invoice-reminder.service"
import { auditService } from "@/lib/services/audit.service"
const { POST, GET } = await import("@/app/api/cron/billing/reminders/route")

const VALID_SECRET = "test-cron-secret-32-bytes-long-aaa"

function makeReq(bearer?: string): NextRequest {
  const headers = new Headers()
  if (bearer !== undefined) {
    headers.set("authorization", `Bearer ${bearer}`)
  }
  return new NextRequest(new URL("/api/cron/billing/reminders", "http://test.local"), {
    method: "POST",
    headers,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = VALID_SECRET
})

afterEach(() => {
  delete process.env.CRON_SECRET
})

describe("POST /api/cron/billing/reminders", () => {
  it("200 + metrics si Bearer correct", async () => {
    const res = await POST(makeReq(VALID_SECRET))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.processed).toBe(0)
    expect(body.byStep).toBeDefined()
    expect(invoiceReminderService.processOverdueInvoices).toHaveBeenCalledTimes(1)
  })

  it("Cache-Control no-store sur la response", async () => {
    const res = await POST(makeReq(VALID_SECRET))
    expect(res.headers.get("Cache-Control")).toContain("no-store")
  })

  it("401 sans header authorization", async () => {
    const res = await POST(makeReq())
    expect(res.status).toBe(401)
    expect(invoiceReminderService.processOverdueInvoices).not.toHaveBeenCalled()
  })

  it("401 si Bearer secret incorrect", async () => {
    const res = await POST(makeReq("wrong-secret"))
    expect(res.status).toBe(401)
  })

  it("401 si format header invalide (pas 'Bearer ...')", async () => {
    const headers = new Headers()
    headers.set("authorization", "Basic dXNlcjpwYXNz")
    const req = new NextRequest(new URL("/api/cron/billing/reminders", "http://test.local"), {
      method: "POST", headers,
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it("503 si CRON_SECRET non configure (defense-in-depth)", async () => {
    delete process.env.CRON_SECRET
    const res = await POST(makeReq(VALID_SECRET))
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toBe("cronDisabled")
  })

  it("retourne 401 generique (pas de leak raison)", async () => {
    const res = await POST(makeReq("totally-different-secret"))
    expect(res.status).toBe(401)
    const body = await res.json()
    // Pas de mention "secret incorrect" ou "Bearer absent".
    expect(body.error).toBe("unauthorized")
  })

  it("comparaison timing-safe : longueurs differentes → 401 sans crash", async () => {
    const res = await POST(makeReq("short"))
    expect(res.status).toBe(401)
  })

  it("processOverdueInvoices recoit ctx audit", async () => {
    await POST(makeReq(VALID_SECRET))
    const call = vi.mocked(invoiceReminderService.processOverdueInvoices).mock.calls[0]
    expect(call![0]).toBeInstanceOf(Date) // now
    expect(call![1]).toHaveProperty("requestId")
  })

  // H2 round 2 — GET accepte aussi (Vercel cron / OVH cron basic)
  it("H2 round 2 — GET accepte (200) avec Bearer correct", async () => {
    const res = await GET(makeReq(VALID_SECRET))
    expect(res.status).toBe(200)
    expect(invoiceReminderService.processOverdueInvoices).toHaveBeenCalled()
  })

  it("H2 round 2 — GET 401 sans Bearer", async () => {
    const res = await GET(makeReq())
    expect(res.status).toBe(401)
  })

  // H9 round 2 — audit auth failed US-2265 (via log direct, userId=null cron).
  it("H9 round 2 — emit audit cron.auth.failed sur 401", async () => {
    await POST(makeReq("wrong-secret"))
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: null, // C1 round 2 — sentinel cron, pas 0
        action: "UNAUTHORIZED",
        resource: "INVOICE_REMINDER",
        resourceId: "cron",
        metadata: expect.objectContaining({ kind: "cron.auth.failed" }),
      }),
    )
  })

  // Headers ANSSI sur toutes les responses (M9 round 2).
  it("headers ANSSI no-referrer + nosniff sur 401", async () => {
    const res = await POST(makeReq("wrong"))
    expect(res.headers.get("Cache-Control")).toContain("no-store")
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer")
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff")
  })

  it("headers ANSSI sur 503", async () => {
    delete process.env.CRON_SECRET
    const res = await POST(makeReq(VALID_SECRET))
    expect(res.headers.get("Cache-Control")).toContain("no-store")
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer")
  })
})
