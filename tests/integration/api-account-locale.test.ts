/**
 * @vitest-environment node
 */

/**
 * Tests: /api/account/locale — US-2112b (préférence de langue)
 *
 * - PUT persiste la préférence en base (`User.language`) ET pose le cookie
 *   `diabeo_locale` + audit UPDATE/USER (AC-2).
 * - PUT rejette une locale hors enum (400, Zod).
 * - GET renvoie { preference, active, mismatch } pour l'alerte de
 *   réconciliation (AC-3) : mismatch ssi cookie présent ≠ préférence.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const { updateMock, findUniqueMock, auditLogMock, cookieSetMock } = vi.hoisted(() => ({
  updateMock: vi.fn().mockResolvedValue({}),
  findUniqueMock: vi.fn(),
  auditLogMock: vi.fn().mockResolvedValue({}),
  cookieSetMock: vi.fn(),
}))

let cookieJar: Record<string, string> = {}

vi.mock("@/lib/auth", () => {
  class FakeAuthError extends Error {
    status: number
    constructor(message: string, status = 401) {
      super(message)
      this.status = status
    }
  }
  return {
    requireAuth: () => ({ id: 7, role: "VIEWER" }),
    AuthError: FakeAuthError,
  }
})

vi.mock("@/lib/db/client", () => ({
  prisma: {
    user: {
      update: (...a: unknown[]) => updateMock(...a),
      findUnique: (...a: unknown[]) => findUniqueMock(...a),
    },
  },
}))

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar[name] ? { value: cookieJar[name] } : undefined),
    set: (...a: unknown[]) => cookieSetMock(...a),
  }),
}))

vi.mock("@/lib/services/audit.service", () => ({
  auditService: { log: auditLogMock },
  extractRequestContext: () => ({ ipAddress: "1.2.3.4", userAgent: "ua", requestId: "req-1" }),
}))

vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }))

import { PUT, GET } from "@/app/api/account/locale/route"

function putReq(body: unknown) {
  return new NextRequest("http://localhost/api/account/locale", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}
function getReq() {
  return new NextRequest("http://localhost/api/account/locale", { method: "GET" })
}

beforeEach(() => {
  vi.clearAllMocks()
  cookieJar = {}
})

describe("PUT /api/account/locale", () => {
  it("persists User.language, sets cookie and audits (AC-2)", async () => {
    const res = await PUT(putReq({ locale: "ar" }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ locale: "ar", persisted: true })
    expect(updateMock).toHaveBeenCalledWith({ where: { id: 7 }, data: { language: "ar" } })
    expect(cookieSetMock).toHaveBeenCalledWith("diabeo_locale", "ar", expect.objectContaining({ httpOnly: false }))
    expect(auditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "UPDATE",
        resource: "USER",
        metadata: expect.objectContaining({ setting: "locale", value: "ar" }),
      }),
    )
  })

  it("rejects an unsupported locale (400)", async () => {
    const res = await PUT(putReq({ locale: "zz" }))
    expect(res.status).toBe(400)
    expect(updateMock).not.toHaveBeenCalled()
  })
})

describe("GET /api/account/locale", () => {
  it("reports mismatch when the active cookie differs from the stored preference", async () => {
    findUniqueMock.mockResolvedValue({ language: "ar" })
    cookieJar = { diabeo_locale: "fr" }
    const res = await GET(getReq())
    expect(await res.json()).toEqual({ preference: "ar", active: "fr", mismatch: true })
  })

  it("no mismatch when active equals preference", async () => {
    findUniqueMock.mockResolvedValue({ language: "ar" })
    cookieJar = { diabeo_locale: "ar" }
    expect(await (await GET(getReq())).json()).toEqual({ preference: "ar", active: "ar", mismatch: false })
  })

  it("no mismatch when cookie is absent (login will seed it from preference)", async () => {
    findUniqueMock.mockResolvedValue({ language: "en" })
    cookieJar = {}
    expect(await (await GET(getReq())).json()).toEqual({ preference: "en", active: null, mismatch: false })
  })

  it("falls back to default preference when User.language is null", async () => {
    findUniqueMock.mockResolvedValue({ language: null })
    cookieJar = {}
    expect(await (await GET(getReq())).json()).toEqual({ preference: "fr", active: null, mismatch: false })
  })
})
