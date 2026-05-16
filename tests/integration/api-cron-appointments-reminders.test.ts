/**
 * @description US-2502 — cron appointments reminders route integration tests.
 */
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/db/client", () => ({ prisma: {} }))

vi.mock("@/lib/services/appointment-reminder.service", () => ({
  appointmentReminderService: {
    processAppointmentReminders: vi.fn().mockResolvedValue({
      processed: 0, sent: 0, failed: 0, skipped: 0,
      timedOut: false, skippedConcurrent: false,
      byChannel: {
        email: { sent: 0, failed: 0, skipped: 0 },
        sms: { sent: 0, failed: 0, skipped: 0 },
        push: { sent: 0, failed: 0, skipped: 0 },
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
    },
  }
})

import { appointmentReminderService } from "@/lib/services/appointment-reminder.service"
import { auditService } from "@/lib/services/audit.service"
const routeModule = await import("@/app/api/cron/appointments/reminders/route")
const { POST } = routeModule

const VALID_SECRET = "test-cron-secret-32-bytes-long-aaa"

function makeReq(bearer?: string): NextRequest {
  const headers = new Headers()
  if (bearer !== undefined) {
    headers.set("authorization", `Bearer ${bearer}`)
  }
  return new NextRequest(new URL("/api/cron/appointments/reminders", "http://test.local"), {
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

describe("POST /api/cron/appointments/reminders", () => {
  it("200 + metrics si Bearer correct", async () => {
    const res = await POST(makeReq(VALID_SECRET))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.byChannel).toBeDefined()
    expect(appointmentReminderService.processAppointmentReminders).toHaveBeenCalledTimes(1)
  })

  // H3 round 2 review — GET retiré (action mutante = POST uniquement,
  // évite leak CRON_SECRET via access logs / Referer). Scheduler doit
  // utiliser `curl -X POST`.
  it("H3 round 2 — GET non exporté (POST uniquement)", () => {
    expect((routeModule as Record<string, unknown>).GET).toBeUndefined()
  })

  it("401 sans Bearer", async () => {
    const res = await POST(makeReq())
    expect(res.status).toBe(401)
    expect(appointmentReminderService.processAppointmentReminders).not.toHaveBeenCalled()
  })

  it("401 Bearer incorrect + audit cron.auth.failed", async () => {
    await POST(makeReq("wrong-secret"))
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: null,
        action: "UNAUTHORIZED",
        resource: "APPOINTMENT_REMINDER",
        resourceId: "cron",
        metadata: expect.objectContaining({ kind: "cron.auth.failed" }),
      }),
    )
  })

  it("503 si CRON_SECRET non configuré", async () => {
    delete process.env.CRON_SECRET
    const res = await POST(makeReq(VALID_SECRET))
    expect(res.status).toBe(503)
  })

  it("headers ANSSI no-store sur toutes responses", async () => {
    const res200 = await POST(makeReq(VALID_SECRET))
    expect(res200.headers.get("Cache-Control")).toContain("no-store")
    const res401 = await POST(makeReq("wrong"))
    expect(res401.headers.get("Cache-Control")).toContain("no-store")
  })
})
