/**
 * @description US-2500-UI iter 4 — Integration tests `/api/account/me-memberships`.
 *
 * Fix M-9 round 2 review PR #432 — couverture route handler :
 * - auth fail (401)
 * - happy path 200 + shape
 * - headers ANSSI (Cache-Control, Pragma, Referrer-Policy, nosniff)
 * - audit READ tiré (forensique HDS)
 * - serverError handled (500 sans leak)
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/db/client", () => ({ prisma: {} }))

vi.mock("@/lib/services/healthcare.service", async (orig) => {
  const actual = await orig<typeof import("@/lib/services/healthcare.service")>()
  return {
    ...actual,
    healthcareService: {
      ...actual.healthcareService,
      getMembershipsForUser: vi.fn(),
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
    },
  }
})

import { healthcareService } from "@/lib/services/healthcare.service"
import { auditService } from "@/lib/services/audit.service"

const { GET } = await import("@/app/api/account/me-memberships/route")

function makeReq(
  init: { auth?: boolean; role?: string; userId?: string } = {},
): NextRequest {
  const headers = new Headers()
  if (init.auth !== false) {
    headers.set("x-user-id", init.userId ?? "42")
    headers.set("x-user-role", init.role ?? "DOCTOR")
  }
  headers.set("x-request-id", "test-req-id")
  headers.set("user-agent", "vitest")
  return new NextRequest(new URL("/api/account/me-memberships", "http://test.local"), {
    method: "GET",
    headers,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("GET /api/account/me-memberships", () => {
  it("401 sans JWT (header x-user-id absent)", async () => {
    const res = await GET(makeReq({ auth: false }))
    expect(res.status).toBe(401)
    // Audit NE doit PAS être tiré si auth fail.
    expect(auditService.log).not.toHaveBeenCalled()
  })

  it("200 retourne items + appelle service avec bon userId", async () => {
    vi.mocked(healthcareService.getMembershipsForUser).mockResolvedValue([
      {
        memberId: 1,
        memberName: "Dr Sophie Martin",
        serviceId: 1,
        serviceName: "Service Diabetologie",
        establishment: "CHU Paris Test",
      },
    ])

    const res = await GET(makeReq({ userId: "42" }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({
      memberId: 1,
      memberName: "Dr Sophie Martin",
    })
    expect(healthcareService.getMembershipsForUser).toHaveBeenCalledWith(42)
  })

  it("headers ANSSI appliqués (M-1 Fix Cache-Control + Pragma + Referrer-Policy + nosniff)", async () => {
    vi.mocked(healthcareService.getMembershipsForUser).mockResolvedValue([])
    const res = await GET(makeReq())

    expect(res.headers.get("Cache-Control")).toBe(
      "no-store, no-cache, must-revalidate, private",
    )
    expect(res.headers.get("Pragma")).toBe("no-cache")
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer")
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff")
  })

  it("audit READ tiré (M-3 forensique HDS — énumération memberships)", async () => {
    vi.mocked(healthcareService.getMembershipsForUser).mockResolvedValue([
      {
        memberId: 1,
        memberName: "Dr Test",
        serviceId: 1,
        serviceName: "Service A",
        establishment: null,
      },
      {
        memberId: 2,
        memberName: "Dr Test 2",
        serviceId: 2,
        serviceName: "Service B",
        establishment: "CHU",
      },
    ])

    await GET(makeReq({ userId: "42" }))

    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 42,
        action: "READ",
        resource: "HEALTHCARE_SERVICE",
        resourceId: "self",
        metadata: { kind: "me-memberships", count: 2 },
      }),
    )
  })

  it("audit metadata.count est cohérent avec items.length=0", async () => {
    vi.mocked(healthcareService.getMembershipsForUser).mockResolvedValue([])
    await GET(makeReq())
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { kind: "me-memberships", count: 0 },
      }),
    )
  })

  it("audit ne contient AUCUNE PHI dans metadata (defense-in-depth)", async () => {
    vi.mocked(healthcareService.getMembershipsForUser).mockResolvedValue([
      {
        memberId: 1,
        memberName: "Dr Sophie Martin", // nom PII
        serviceId: 1,
        serviceName: "Service Diabetologie",
        establishment: "CHU Paris Test",
      },
    ])

    await GET(makeReq())
    const call = vi.mocked(auditService.log).mock.calls[0]?.[0]
    const metaJson = JSON.stringify(call?.metadata ?? {})
    // Garantie : metadata ne fuit aucun nom membre / établissement.
    expect(metaJson).not.toContain("Sophie")
    expect(metaJson).not.toContain("Martin")
    expect(metaJson).not.toContain("CHU")
  })

  it("500 si service throw (catch all + pas de leak interne)", async () => {
    vi.mocked(healthcareService.getMembershipsForUser).mockRejectedValue(
      new Error("DB connection refused"),
    )

    const res = await GET(makeReq())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe("serverError")
    // Pas de stack trace ni détail interne.
    expect(JSON.stringify(body)).not.toContain("DB connection")
  })
})
