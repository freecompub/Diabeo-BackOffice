/**
 * @description US-2500-UI iter 5 — Integration test sur les headers ANSSI/HDS
 * de la route `GET /api/appointments/[id]`.
 *
 * Fix HSA-1 round 1 review PR #433 — asymétrie corrigée vs la route liste
 * (`src/app/api/appointments/route.ts`) qui posait déjà ces headers.
 * La route détail est CRITIQUE car elle sert des PHI déchiffrés (motif/note/
 * cancelReason) — un proxy mal configuré ou le bfcache navigateur pourraient
 * retenir le payload sans `Cache-Control: no-store`.
 *
 * Couvre :
 *   - 200 + détail → 4 headers présents
 *   - 404 → 4 headers présents (pas de leak d'existence + pas de cache 404)
 *   - 401/403 → headers présents
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/db/client", () => ({
  prisma: {
    appointment: {
      findUnique: vi.fn(),
    },
  },
}))

vi.mock("@/lib/services/rdv.service", async (orig) => {
  const actual = await orig<typeof import("@/lib/services/rdv.service")>()
  return {
    ...actual,
    rdvAppointmentService: {
      ...actual.rdvAppointmentService,
      getById: vi.fn(),
    },
  }
})

vi.mock("@/lib/appointments-route-helpers", async (orig) => {
  const actual = await orig<typeof import("@/lib/appointments-route-helpers")>()
  return {
    ...actual,
    appointmentRouteGate: vi.fn(),
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

import { rdvAppointmentService } from "@/lib/services/rdv.service"
import { appointmentRouteGate } from "@/lib/appointments-route-helpers"
import { NextResponse } from "next/server"

const { GET } = await import("@/app/api/appointments/[id]/route")

function makeReq(): NextRequest {
  const headers = new Headers()
  headers.set("x-user-id", "1")
  headers.set("x-user-role", "DOCTOR")
  headers.set("x-request-id", "test-req-id")
  return new NextRequest(new URL("/api/appointments/42", "http://test.local"), {
    method: "GET",
    headers,
  })
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

function assertSecurityHeaders(res: Response) {
  expect(res.headers.get("Cache-Control")).toBe(
    "no-store, no-cache, must-revalidate, private",
  )
  expect(res.headers.get("Pragma")).toBe("no-cache")
  expect(res.headers.get("Referrer-Policy")).toBe("no-referrer")
  expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff")
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("GET /api/appointments/[id] — Headers ANSSI/HDS (Fix HSA-1)", () => {
  it("200 succès → 4 headers de sécurité présents", async () => {
    vi.mocked(appointmentRouteGate).mockResolvedValue({
      kind: "ok",
      apptId: 42,
      patientId: 7,
      user: { id: 1, role: "DOCTOR" },
    } as never)
    vi.mocked(rdvAppointmentService.getById).mockResolvedValue({
      id: 42,
      patientId: 7,
      memberId: 1,
      type: "diabeto",
      date: new Date("2026-05-25"),
      hour: new Date("1970-01-01T09:30:00Z"),
      durationMinutes: 30,
      location: "in_person",
      status: "confirmed",
      motif: "Test motif déchiffré",
      note: null,
      proposedAlternativeAt: null,
      cancelledBy: null,
      cancelReason: null,
      cancelledAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never)

    const res = await GET(makeReq(), makeParams("42"))
    expect(res.status).toBe(200)
    assertSecurityHeaders(res)
  })

  it("404 notFound → 4 headers présents (pas de leak existence + 404 non-cacheable)", async () => {
    vi.mocked(appointmentRouteGate).mockResolvedValue({
      kind: "ok",
      apptId: 9999,
      patientId: 7,
      user: { id: 1, role: "DOCTOR" },
    } as never)
    vi.mocked(rdvAppointmentService.getById).mockResolvedValue(null)

    const res = await GET(makeReq(), makeParams("9999"))
    expect(res.status).toBe(404)
    assertSecurityHeaders(res)
  })

  it("403 forbidden (gate refuse) → headers propagés", async () => {
    const forbiddenRes = NextResponse.json({ error: "forbidden" }, { status: 403 })
    vi.mocked(appointmentRouteGate).mockResolvedValue({
      kind: "error",
      res: forbiddenRes,
    } as never)

    const res = await GET(makeReq(), makeParams("42"))
    expect(res.status).toBe(403)
    assertSecurityHeaders(res)
  })

  it("payload JSON contient motif déchiffré (sanity check — la sécurité headers est NÉCESSAIRE car PHI réel)", async () => {
    vi.mocked(appointmentRouteGate).mockResolvedValue({
      kind: "ok",
      apptId: 42,
      patientId: 7,
      user: { id: 1, role: "DOCTOR" },
    } as never)
    vi.mocked(rdvAppointmentService.getById).mockResolvedValue({
      id: 42,
      patientId: 7,
      memberId: 1,
      type: "diabeto",
      date: new Date("2026-05-25"),
      hour: new Date("1970-01-01T09:30:00Z"),
      durationMinutes: 30,
      location: "in_person",
      status: "confirmed",
      motif: "Titration basale post-hypos",
      note: "Note médicale confidentielle",
      proposedAlternativeAt: null,
      cancelledBy: null,
      cancelReason: null,
      cancelledAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never)

    const res = await GET(makeReq(), makeParams("42"))
    expect(res.status).toBe(200)
    const body = await res.json()
    // PHI déchiffrés dans le payload → c'est précisément pourquoi
    // `Cache-Control: no-store` est obligatoire (HSA-1).
    expect(body.motif).toBe("Titration basale post-hypos")
    expect(body.note).toBe("Note médicale confidentielle")
    // Et bien sûr les headers sont posés.
    assertSecurityHeaders(res)
  })

  /**
   * Fix HSA-2-9 round 2 review PR #433 — couvre le path `mapErrorToResponse`
   * (500 service throw → headers présents). Sans ce test, un futur refactor
   * du catch pourrait omettre `setAppointmentSecurityHeaders` et casser
   * silencieusement la promesse no-store sur les erreurs serveur.
   */
  it("500 service throw → headers présents (HSA-2-9 catch mapErrorToResponse)", async () => {
    vi.mocked(appointmentRouteGate).mockResolvedValue({
      kind: "ok",
      apptId: 42,
      patientId: 7,
      user: { id: 1, role: "DOCTOR" },
    } as never)
    vi.mocked(rdvAppointmentService.getById).mockRejectedValue(
      new Error("Prisma timeout"),
    )

    const res = await GET(makeReq(), makeParams("42"))
    expect(res.status).toBe(500)
    assertSecurityHeaders(res)
  })
})
