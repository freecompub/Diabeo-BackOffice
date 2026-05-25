/**
 * @description PR #438 — Fix B1 + B2 + H3 round 1 review : tests integration
 * pour valider que VIEWER (patient) peut accéder à `/api/appointments?patientId=self`
 * et POST `/api/appointments/[id]/accept-alternative` UNIQUEMENT sur son
 * propre patient. IDOR `?patientId=<other>` doit retourner 403 + audit.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/db/client", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    session: { findUnique: vi.fn() },
    appointment: { findUnique: vi.fn() },
    patient: { findFirst: vi.fn() },
    patientService: { findFirst: vi.fn() },
  },
}))

vi.mock("@/lib/services/rdv.service", async (orig) => {
  const actual = await orig<typeof import("@/lib/services/rdv.service")>()
  return {
    ...actual,
    rdvAppointmentService: {
      ...actual.rdvAppointmentService,
      listInRange: vi.fn(),
      acceptAlternative: vi.fn(),
      getPatientIdFor: vi.fn(),
    },
    assertMemberServiceAccess: vi.fn().mockResolvedValue(undefined),
  }
})

vi.mock("@/lib/access-control", async (orig) => {
  const actual = await orig<typeof import("@/lib/access-control")>()
  return {
    ...actual,
    canAccessPatient: vi.fn(),
  }
})

vi.mock("@/lib/consent", () => ({
  patientShareConsent: vi.fn().mockResolvedValue({ ok: true }),
}))

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

vi.mock("@/lib/team-route-helpers", async (orig) => {
  const actual = await orig<typeof import("@/lib/team-route-helpers")>()
  return {
    ...actual,
    auditedRequireRole: vi.fn(),
  }
})

import { rdvAppointmentService } from "@/lib/services/rdv.service"
import { canAccessPatient } from "@/lib/access-control"
import { auditService } from "@/lib/services/audit.service"
import { auditedRequireRole } from "@/lib/team-route-helpers"

const { GET: GET_LIST } = await import("@/app/api/appointments/route")
const { POST: POST_ACCEPT_ALT } = await import("@/app/api/appointments/[id]/accept-alternative/route")

function makeReqList(qs: Record<string, string>, role = "VIEWER", userId = 42): NextRequest {
  const url = new URL("/api/appointments", "http://test.local")
  for (const [k, v] of Object.entries(qs)) url.searchParams.set(k, v)
  const headers = new Headers()
  headers.set("x-user-id", String(userId))
  headers.set("x-user-role", role)
  headers.set("x-request-id", "test-req-id")
  return new NextRequest(url, { method: "GET", headers })
}

function makeReqAcceptAlt(role = "VIEWER", userId = 42): NextRequest {
  const headers = new Headers()
  headers.set("x-user-id", String(userId))
  headers.set("x-user-role", role)
  headers.set("x-request-id", "test-req-id")
  return new NextRequest(new URL("/api/appointments/100/accept-alternative", "http://test.local"), {
    method: "POST",
    headers,
  })
}

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
})

describe("Fix B1 PR #438 — GET /api/appointments VIEWER access", () => {
  it("VIEWER avec patientId=self → 200 + items retournés", async () => {
    vi.mocked(auditedRequireRole).mockResolvedValue({ id: 42, role: "VIEWER" } as never)
    vi.mocked(canAccessPatient).mockResolvedValue(true)
    vi.mocked(rdvAppointmentService.listInRange).mockResolvedValue({
      items: [],
      truncated: false,
    } as never)

    const req = makeReqList({
      from: "2026-05-01",
      to: "2026-06-30",
      patientId: "7",
    }, "VIEWER", 42)
    const res = await GET_LIST(req)
    expect(res.status).toBe(200)
    expect(vi.mocked(canAccessPatient)).toHaveBeenCalledWith(42, "VIEWER", 7)
  })

  it("Fix H3 PR #438 — VIEWER avec patientId=<other> → 403 + audit accessDenied (anti-IDOR)", async () => {
    vi.mocked(auditedRequireRole).mockResolvedValue({ id: 42, role: "VIEWER" } as never)
    vi.mocked(canAccessPatient).mockResolvedValue(false) // patient 99 ≠ own patient

    const req = makeReqList({
      from: "2026-05-01",
      to: "2026-06-30",
      patientId: "99",
    }, "VIEWER", 42)
    const res = await GET_LIST(req)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe("forbidden")
    expect(vi.mocked(auditService.accessDenied)).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 42,
        resource: "APPOINTMENT",
        resourceId: "99",
        metadata: expect.objectContaining({ patientId: 99, endpoint: "list" }),
      }),
    )
  })

  it("Fix B1 defense-in-depth — VIEWER + memberId interdit → 403 + audit", async () => {
    vi.mocked(auditedRequireRole).mockResolvedValue({ id: 42, role: "VIEWER" } as never)

    const req = makeReqList({
      from: "2026-05-01",
      to: "2026-06-30",
      memberId: "10",
    }, "VIEWER", 42)
    const res = await GET_LIST(req)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe("forbidden")
    expect(vi.mocked(auditService.accessDenied)).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 42,
        metadata: expect.objectContaining({
          memberId: 10,
          reason: "viewer_member_scope_forbidden",
        }),
      }),
    )
  })

  it("VIEWER + scope missing → 400 scopeRequired", async () => {
    const req = makeReqList({
      from: "2026-05-01",
      to: "2026-06-30",
    }, "VIEWER", 42)
    const res = await GET_LIST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("scopeRequired")
  })

  it("NURSE peut toujours utiliser memberId (regression test)", async () => {
    vi.mocked(auditedRequireRole).mockResolvedValue({ id: 100, role: "NURSE" } as never)
    vi.mocked(rdvAppointmentService.listInRange).mockResolvedValue({
      items: [],
      truncated: false,
    } as never)

    const req = makeReqList({
      from: "2026-05-01",
      to: "2026-06-30",
      memberId: "10",
    }, "NURSE", 100)
    const res = await GET_LIST(req)
    expect(res.status).toBe(200)
  })
})

describe("Fix B2 PR #438 — POST /api/appointments/[id]/accept-alternative VIEWER access", () => {
  it("VIEWER sur own appointment → 200 (helper enforce ownership via canAccessPatient)", async () => {
    // appointmentRouteGate sera invoqué : il appelle auditedRequireRole(req, VIEWER, ...)
    // puis getPatientIdFor puis canAccessPatient. On mocke directement.
    vi.mocked(auditedRequireRole).mockResolvedValue({ id: 42, role: "VIEWER" } as never)
    vi.mocked(rdvAppointmentService.getPatientIdFor).mockResolvedValue(7)
    vi.mocked(canAccessPatient).mockResolvedValue(true)
    vi.mocked(rdvAppointmentService.acceptAlternative).mockResolvedValue({
      id: 100,
      status: "scheduled",
      date: new Date("2026-06-15"),
      hour: new Date("1970-01-01T09:30:00Z"),
    } as never)

    const res = await POST_ACCEPT_ALT(makeReqAcceptAlt("VIEWER", 42), makeParams("100"))
    expect(res.status).toBe(200)
    expect(vi.mocked(rdvAppointmentService.acceptAlternative)).toHaveBeenCalledWith(100, 42, expect.anything(), "VIEWER")
  })

  it("VIEWER sur appointment d'un autre patient → 403 + audit accessDenied", async () => {
    vi.mocked(auditedRequireRole).mockResolvedValue({ id: 42, role: "VIEWER" } as never)
    vi.mocked(rdvAppointmentService.getPatientIdFor).mockResolvedValue(99) // patient 99 ≠ own
    vi.mocked(canAccessPatient).mockResolvedValue(false)

    const res = await POST_ACCEPT_ALT(makeReqAcceptAlt("VIEWER", 42), makeParams("100"))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe("forbidden")
    expect(vi.mocked(auditService.accessDenied)).toHaveBeenCalled()
  })

  it("NURSE peut toujours accepter au nom du patient (regression test)", async () => {
    vi.mocked(auditedRequireRole).mockResolvedValue({ id: 100, role: "NURSE" } as never)
    vi.mocked(rdvAppointmentService.getPatientIdFor).mockResolvedValue(7)
    vi.mocked(canAccessPatient).mockResolvedValue(true)
    vi.mocked(rdvAppointmentService.acceptAlternative).mockResolvedValue({
      id: 100,
      status: "scheduled",
    } as never)

    const res = await POST_ACCEPT_ALT(makeReqAcceptAlt("NURSE", 100), makeParams("100"))
    expect(res.status).toBe(200)
  })
})
