/**
 * @description Fix CR-H1 round 1 review PR #434 — Integration test sur les
 * headers ANSSI/HDS de la route `GET /api/patients/search`.
 *
 * Régression révélée par PR #434 iter 6 : la route servait des PHI déchiffrés
 * (`user.firstname`/`lastname` jusqu'à 50 patients) sans `Cache-Control: no-store`
 * ni les 3 autres headers ANSSI. Asymétrie corrigée par `setPatientsSearchSecurityHeaders`
 * helper local dans la route (pattern à généraliser V1.5 via middleware).
 *
 * Couvre 200 + 400 + 500 paths return.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/db/client", () => ({ prisma: {} }))

vi.mock("@/lib/services/patient.service", async (orig) => {
  const actual = await orig<typeof import("@/lib/services/patient.service")>()
  return {
    ...actual,
    patientService: {
      ...actual.patientService,
      search: vi.fn(),
    },
  }
})

vi.mock("@/lib/access-control", () => ({
  getAccessiblePatientIds: vi.fn().mockResolvedValue([1, 2, 3]),
}))

import { patientService } from "@/lib/services/patient.service"

const { GET } = await import("@/app/api/patients/search/route")

function makeReq(query: string = ""): NextRequest {
  const headers = new Headers()
  headers.set("x-user-id", "1")
  headers.set("x-user-role", "DOCTOR")
  headers.set("x-request-id", "test-req-id")
  return new NextRequest(new URL(`/api/patients/search${query}`, "http://test.local"), {
    method: "GET",
    headers,
  })
}

function assertSecurityHeaders(res: Response, label: string) {
  expect(res.headers.get("Cache-Control"), `${label}: Cache-Control`).toBe(
    "no-store, no-cache, must-revalidate, private",
  )
  expect(res.headers.get("Pragma"), `${label}: Pragma`).toBe("no-cache")
  expect(res.headers.get("Referrer-Policy"), `${label}: Referrer-Policy`).toBe("no-referrer")
  expect(res.headers.get("X-Content-Type-Options"), `${label}: X-Content-Type-Options`).toBe(
    "nosniff",
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("CR-H1 round 1 — GET /api/patients/search headers ANSSI/HDS", () => {
  it("200 succès → 4 headers présents (PHI firstname/lastname déchiffrés)", async () => {
    vi.mocked(patientService.search).mockResolvedValue({
      items: [
        { id: 1, user: { firstname: "Jean", lastname: "Durand" } } as never,
      ],
      nextCursor: null,
    })

    const res = await GET(makeReq("?limit=50"))
    expect(res.status).toBe(200)
    assertSecurityHeaders(res, "search 200")

    const body = await res.json()
    // PHI déchiffrés dans le payload — c'est précisément pourquoi
    // `Cache-Control: no-store` est obligatoire (CR-H1).
    expect(body.items[0].user.firstname).toBe("Jean")
  })

  it("400 validation failed → 4 headers présents", async () => {
    // search > 100 chars = invalid
    const res = await GET(makeReq("?search=" + "x".repeat(150)))
    expect(res.status).toBe(400)
    assertSecurityHeaders(res, "search 400")
  })

  it("500 service throw → 4 headers présents", async () => {
    vi.mocked(patientService.search).mockRejectedValue(new Error("DB connection refused"))

    const res = await GET(makeReq("?limit=50"))
    expect(res.status).toBe(500)
    assertSecurityHeaders(res, "search 500")
  })

  it("401 sans x-user-id → headers présents (couvre AuthError path)", async () => {
    const headers = new Headers()
    headers.set("x-request-id", "test-req-id")
    // Pas de x-user-id ni x-user-role → requireRole throw AuthError
    const req = new NextRequest(new URL("/api/patients/search", "http://test.local"), {
      method: "GET",
      headers,
    })
    const res = await GET(req)
    expect(res.status).toBe(401)
    assertSecurityHeaders(res, "search 401")
  })
})
