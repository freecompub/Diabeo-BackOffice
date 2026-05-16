/**
 * @description US-2506 V1 mock — admin SMS config route integration tests.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/db/client", () => ({ prisma: {} }))

vi.mock("@/lib/services/sms.service", async (orig) => {
  const actual = await orig<typeof import("@/lib/services/sms.service")>()
  return {
    ...actual,
    smsService: {
      getConfig: vi.fn(),
      updateConfig: vi.fn(),
    },
  }
})

import { smsService, SmsValidationError } from "@/lib/services/sms.service"
const { GET, PUT } = await import("@/app/api/cabinet/[id]/sms-config/route")

function makeReq(
  url: string,
  init: RequestInit & { auth?: boolean; role?: string } = {},
): NextRequest {
  const headers = new Headers(init.headers)
  if (init.auth !== false) {
    headers.set("x-user-id", "1")
    headers.set("x-user-role", init.role ?? "ADMIN")
  }
  return new NextRequest(new URL(url, "http://test.local"), {
    method: init.method ?? "GET",
    headers,
    body: init.body,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("GET /api/cabinet/[id]/sms-config", () => {
  it("200 ADMIN retourne config", async () => {
    vi.mocked(smsService.getConfig).mockResolvedValue({
      smsEnabled: true, smsCreditBalance: 100,
    })
    const res = await GET(
      makeReq("/api/cabinet/1/sms-config"),
      { params: Promise.resolve({ id: "1" }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.smsEnabled).toBe(true)
    expect(body.smsCreditBalance).toBe(100)
  })

  it("401 sans JWT", async () => {
    const res = await GET(
      makeReq("/api/cabinet/1/sms-config", { auth: false }),
      { params: Promise.resolve({ id: "1" }) },
    )
    expect(res.status).toBe(401)
  })

  it("403 non-ADMIN (DOCTOR)", async () => {
    const res = await GET(
      makeReq("/api/cabinet/1/sms-config", { role: "DOCTOR" }),
      { params: Promise.resolve({ id: "1" }) },
    )
    expect(res.status).toBe(403)
  })

  it("404 cabinet introuvable", async () => {
    vi.mocked(smsService.getConfig).mockRejectedValue(
      new SmsValidationError("cabinetId", "notFound"),
    )
    const res = await GET(
      makeReq("/api/cabinet/999/sms-config"),
      { params: Promise.resolve({ id: "999" }) },
    )
    expect(res.status).toBe(404)
  })
})

describe("PUT /api/cabinet/[id]/sms-config", () => {
  it("200 toggle smsEnabled OK", async () => {
    vi.mocked(smsService.updateConfig).mockResolvedValue({
      smsEnabled: true, smsCreditBalance: 0,
    })
    const res = await PUT(
      makeReq("/api/cabinet/1/sms-config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ smsEnabled: true }),
      }),
      { params: Promise.resolve({ id: "1" }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.smsEnabled).toBe(true)
  })

  it("200 ajuste credits", async () => {
    vi.mocked(smsService.updateConfig).mockResolvedValue({
      smsEnabled: true, smsCreditBalance: 500,
    })
    const res = await PUT(
      makeReq("/api/cabinet/1/sms-config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ smsCreditBalance: 500 }),
      }),
      { params: Promise.resolve({ id: "1" }) },
    )
    expect(res.status).toBe(200)
  })

  it("403 non-ADMIN", async () => {
    const res = await PUT(
      makeReq("/api/cabinet/1/sms-config", {
        method: "PUT", role: "DOCTOR",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ smsEnabled: true }),
      }),
      { params: Promise.resolve({ id: "1" }) },
    )
    expect(res.status).toBe(403)
  })

  it("422 body vide (atLeastOneFieldRequired)", async () => {
    const res = await PUT(
      makeReq("/api/cabinet/1/sms-config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: "1" }) },
    )
    expect(res.status).toBe(422)
  })

  it("422 credits négatifs", async () => {
    vi.mocked(smsService.updateConfig).mockRejectedValue(
      new SmsValidationError("smsCreditBalance", "negative"),
    )
    const res = await PUT(
      makeReq("/api/cabinet/1/sms-config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ smsCreditBalance: 100 }),
      }),
      { params: Promise.resolve({ id: "1" }) },
    )
    expect(res.status).toBe(422)
  })

  it("404 cabinet introuvable", async () => {
    vi.mocked(smsService.updateConfig).mockRejectedValue(
      new SmsValidationError("cabinetId", "notFound"),
    )
    const res = await PUT(
      makeReq("/api/cabinet/999/sms-config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ smsEnabled: true }),
      }),
      { params: Promise.resolve({ id: "999" }) },
    )
    expect(res.status).toBe(404)
  })

  it("415 sans Content-Type JSON", async () => {
    const res = await PUT(
      makeReq("/api/cabinet/1/sms-config", {
        method: "PUT",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ smsEnabled: true }),
      }),
      { params: Promise.resolve({ id: "1" }) },
    )
    expect(res.status).toBe(415)
  })

  it("headers ANSSI no-store + nosniff", async () => {
    vi.mocked(smsService.updateConfig).mockResolvedValue({
      smsEnabled: true, smsCreditBalance: 100,
    })
    const res = await PUT(
      makeReq("/api/cabinet/1/sms-config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ smsEnabled: true }),
      }),
      { params: Promise.resolve({ id: "1" }) },
    )
    expect(res.headers.get("Cache-Control")).toContain("no-store")
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff")
  })
})
