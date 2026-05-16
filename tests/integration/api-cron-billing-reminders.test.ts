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

import { invoiceReminderService } from "@/lib/services/invoice-reminder.service"
const { POST } = await import("@/app/api/cron/billing/reminders/route")

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
})
