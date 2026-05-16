/**
 * @description US-2110 — Integration tests `/api/config/tax-rules/active`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/db/client", () => ({ prisma: {} }))

vi.mock("@/lib/services/country-config.service", async (orig) => {
  const actual = await orig<typeof import("@/lib/services/country-config.service")>()
  return {
    ...actual,
    countryTaxRuleService: {
      ...actual.countryTaxRuleService,
      getActiveAt: vi.fn(),
    },
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

import { countryTaxRuleService } from "@/lib/services/country-config.service"

const { GET } = await import("@/app/api/config/tax-rules/active/route")

function makeReq(
  url: string,
  init: RequestInit & { auth?: boolean; role?: string } = {},
): NextRequest {
  const headers = new Headers(init.headers)
  if (init.auth !== false) {
    headers.set("x-user-id", "1")
    headers.set("x-user-role", init.role ?? "NURSE")
  }
  return new NextRequest(new URL(url, "http://test.local"), {
    method: "GET", headers,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("GET /api/config/tax-rules/active", () => {
  it("401 sans JWT", async () => {
    const res = await GET(makeReq(
      "/api/config/tax-rules/active?countryCode=FR&taxType=VAT",
      { auth: false },
    ))
    expect(res.status).toBe(401)
  })

  it("400 query invalide", async () => {
    const res = await GET(makeReq("/api/config/tax-rules/active"))
    expect(res.status).toBe(400)
  })

  it("200 retourne la règle active", async () => {
    vi.mocked(countryTaxRuleService.getActiveAt).mockResolvedValue({
      id: 1, countryCode: "FR", taxType: "VAT", baseRate: 0.2,
      description: null,
      appliesFrom: new Date("2024-01-01"),
      appliesUntil: null,
      isActive: true,
      createdAt: new Date(), updatedAt: new Date(),
    } as any)
    const res = await GET(makeReq(
      "/api/config/tax-rules/active?countryCode=FR&taxType=VAT",
    ))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rule.baseRate).toBe(0.2)
  })

  it("404 si aucune règle active", async () => {
    vi.mocked(countryTaxRuleService.getActiveAt).mockResolvedValue(null)
    const res = await GET(makeReq(
      "/api/config/tax-rules/active?countryCode=DZ&taxType=VAT",
    ))
    expect(res.status).toBe(404)
  })

  it("400 si taxType invalide", async () => {
    const res = await GET(makeReq(
      "/api/config/tax-rules/active?countryCode=FR&taxType=INVALID",
    ))
    expect(res.status).toBe(400)
  })

  it("400 si countryCode lowercase", async () => {
    const res = await GET(makeReq(
      "/api/config/tax-rules/active?countryCode=fr&taxType=VAT",
    ))
    expect(res.status).toBe(400)
  })

  it("supporte date param ISO", async () => {
    vi.mocked(countryTaxRuleService.getActiveAt).mockResolvedValue({
      id: 1, countryCode: "FR", taxType: "VAT", baseRate: 0.196,
      description: "TVA 19.6% pre-2014",
      appliesFrom: new Date("2010-01-01"),
      appliesUntil: new Date("2014-01-01"),
      isActive: true,
      createdAt: new Date(), updatedAt: new Date(),
    } as any)
    const res = await GET(makeReq(
      "/api/config/tax-rules/active?countryCode=FR&taxType=VAT&date=2013-06-01",
    ))
    expect(res.status).toBe(200)
    expect(vi.mocked(countryTaxRuleService.getActiveAt)).toHaveBeenCalledWith(
      "FR", "VAT", expect.any(Date),
    )
  })
})
