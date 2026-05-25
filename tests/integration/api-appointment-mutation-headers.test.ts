/**
 * @description US-2500-UI iter 5 round 2 — Integration test headers ANSSI/HDS
 * sur les routes mutables de `/api/appointments/[id]/*`.
 *
 * Fix HSA-2-1 + HSA-2-2 round 2 review PR #433 — Régression round 1 :
 * `setSecurityHeaders` n'avait été appliqué qu'au GET, mais les 5 routes
 * mutables (PUT + cancel + propose-alternative + accept-alternative + confirm)
 * retournent toutes `AppointmentDTO` complet déchiffré → mêmes risques
 * bfcache + proxies + Referer leak.
 *
 * Couvre les 5 routes × {200 succès, 401 unauth} + le path 400 validation
 * pour PUT + cancel.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/db/client", () => ({ prisma: {} }))

vi.mock("@/lib/services/rdv.service", async (orig) => {
  const actual = await orig<typeof import("@/lib/services/rdv.service")>()
  return {
    ...actual,
    rdvAppointmentService: {
      ...actual.rdvAppointmentService,
      update: vi.fn(),
      cancel: vi.fn(),
      proposeAlternative: vi.fn(),
      acceptAlternative: vi.fn(),
      confirm: vi.fn(),
      create: vi.fn(),
    },
    assertMemberServiceAccess: vi.fn().mockResolvedValue(undefined),
  }
})

vi.mock("@/lib/access-control", () => ({
  canAccessPatient: vi.fn().mockResolvedValue(true),
}))

vi.mock("@/lib/consent", () => ({
  patientShareConsent: vi.fn().mockResolvedValue({ ok: true }),
}))

vi.mock("@/lib/team-route-helpers", async (orig) => {
  const actual = await orig<typeof import("@/lib/team-route-helpers")>()
  return {
    ...actual,
    auditedRequireRole: vi.fn().mockResolvedValue({
      id: 1, role: "DOCTOR", email: "doctor@test.local",
    }),
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

const { PUT } = await import("@/app/api/appointments/[id]/route")
const { POST: cancelPOST } = await import("@/app/api/appointments/[id]/cancel/route")
const { POST: proposePOST } = await import(
  "@/app/api/appointments/[id]/propose-alternative/route"
)
const { POST: acceptPOST } = await import(
  "@/app/api/appointments/[id]/accept-alternative/route"
)
const { POST: confirmPOST } = await import(
  "@/app/api/appointments/[id]/confirm/route"
)
// US-2500-UI iter 6 — POST /api/appointments (création).
const { POST: createPOST } = await import("@/app/api/appointments/route")

function makeReq(method: string, body?: unknown): NextRequest {
  const headers = new Headers()
  headers.set("x-user-id", "1")
  headers.set("x-user-role", "DOCTOR")
  headers.set("x-request-id", "test-req-id")
  if (body !== undefined) headers.set("content-type", "application/json")
  return new NextRequest(new URL("/api/appointments/42", "http://test.local"), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

function makeParams() {
  return { params: Promise.resolve({ id: "42" }) }
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

const stubGateOk = {
  kind: "ok",
  apptId: 42,
  patientId: 7,
  user: { id: 1, role: "DOCTOR" as const },
  ctx: { ipAddress: "::1", userAgent: "vitest", requestId: "test-req-id" },
}

const stubGateForbidden = {
  kind: "error",
  res: NextResponse.json({ error: "forbidden" }, { status: 403 }),
}

const stubAppointmentDTO = {
  id: 42,
  patientId: 7,
  memberId: 1,
  type: "diabeto",
  date: new Date("2026-05-25"),
  hour: new Date("1970-01-01T09:30:00Z"),
  durationMinutes: 30,
  location: "in_person",
  status: "confirmed",
  motif: "PHI déchiffré",
  note: "Note PHI",
  proposedAlternativeAt: null,
  cancelledBy: null,
  cancelReason: null,
  cancelledAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("HSA-2-1 — PUT /api/appointments/[id] headers", () => {
  it("200 succès → 4 headers présents (avec PHI déchiffrés)", async () => {
    vi.mocked(appointmentRouteGate).mockResolvedValue(stubGateOk as never)
    vi.mocked(rdvAppointmentService.update).mockResolvedValue(stubAppointmentDTO as never)

    const res = await PUT(makeReq("PUT", { motif: "Nouveau motif" }), makeParams())
    expect(res.status).toBe(200)
    assertSecurityHeaders(res, "PUT 200")
  })

  it("400 validation failed → 4 headers présents", async () => {
    vi.mocked(appointmentRouteGate).mockResolvedValue(stubGateOk as never)

    const res = await PUT(
      makeReq("PUT", { durationMinutes: 999 }), // > 240 max
      makeParams(),
    )
    expect(res.status).toBe(400)
    assertSecurityHeaders(res, "PUT 400")
  })

  it("403 forbidden gate → 4 headers présents", async () => {
    vi.mocked(appointmentRouteGate).mockResolvedValue(stubGateForbidden as never)

    const res = await PUT(makeReq("PUT", { motif: "x" }), makeParams())
    expect(res.status).toBe(403)
    assertSecurityHeaders(res, "PUT 403")
  })
})

describe("HSA-2-2 — POST /cancel headers", () => {
  it("200 succès → 4 headers présents", async () => {
    vi.mocked(appointmentRouteGate).mockResolvedValue(stubGateOk as never)
    vi.mocked(rdvAppointmentService.cancel).mockResolvedValue({
      ...stubAppointmentDTO,
      status: "cancelled",
    } as never)

    const res = await cancelPOST(
      makeReq("POST", { actor: "doctor", reason: "Test" }),
      makeParams(),
    )
    expect(res.status).toBe(200)
    assertSecurityHeaders(res, "cancel 200")
  })

  it("400 validation failed → 4 headers présents", async () => {
    vi.mocked(appointmentRouteGate).mockResolvedValue(stubGateOk as never)

    const res = await cancelPOST(
      makeReq("POST", { actor: "invalid" }), // actor doit être patient|doctor
      makeParams(),
    )
    expect(res.status).toBe(400)
    assertSecurityHeaders(res, "cancel 400")
  })

  it("403 forbidden gate → 4 headers présents", async () => {
    vi.mocked(appointmentRouteGate).mockResolvedValue(stubGateForbidden as never)

    const res = await cancelPOST(
      makeReq("POST", { actor: "doctor" }),
      makeParams(),
    )
    expect(res.status).toBe(403)
    assertSecurityHeaders(res, "cancel 403")
  })
})

describe("HSA-2-2 — POST /propose-alternative headers", () => {
  it("200 succès → 4 headers présents", async () => {
    vi.mocked(appointmentRouteGate).mockResolvedValue(stubGateOk as never)
    vi.mocked(rdvAppointmentService.proposeAlternative).mockResolvedValue({
      ...stubAppointmentDTO,
      proposedAlternativeAt: new Date("2026-06-01T14:00:00Z"),
    } as never)

    const res = await proposePOST(
      makeReq("POST", { alternativeAt: "2026-06-01T14:00:00Z" }),
      makeParams(),
    )
    expect(res.status).toBe(200)
    assertSecurityHeaders(res, "propose 200")
  })

  it("400 validation failed → 4 headers présents", async () => {
    vi.mocked(appointmentRouteGate).mockResolvedValue(stubGateOk as never)

    const res = await proposePOST(
      makeReq("POST", { alternativeAt: "not-a-date" }),
      makeParams(),
    )
    expect(res.status).toBe(400)
    assertSecurityHeaders(res, "propose 400")
  })

  /**
   * Fix HSA-2-3 round 2 — vérifie que le contrat backend `z.coerce.date()`
   * accepte bien le format ISO `YYYY-MM-DDTHH:MM:SSZ` envoyé par le frontend.
   */
  it("contrat timezone : accept ISO suffixé Z (HSA-2-3 wall-clock)", async () => {
    vi.mocked(appointmentRouteGate).mockResolvedValue(stubGateOk as never)
    vi.mocked(rdvAppointmentService.proposeAlternative).mockResolvedValue(
      stubAppointmentDTO as never,
    )

    await proposePOST(
      makeReq("POST", { alternativeAt: "2026-06-01T14:00:00Z" }),
      makeParams(),
    )
    // Le service est appelé avec une Date dérivée de l'ISO Z.
    const calledWith = vi.mocked(rdvAppointmentService.proposeAlternative).mock.calls[0]?.[1]
    expect(calledWith).toBeInstanceOf(Date)
    // 14:00 UTC = 14h heure UTC dans l'objet Date.
    expect((calledWith as Date).getUTCHours()).toBe(14)
  })
})

describe("HSA-2-2 — POST /accept-alternative headers", () => {
  it("200 succès → 4 headers présents", async () => {
    vi.mocked(appointmentRouteGate).mockResolvedValue(stubGateOk as never)
    vi.mocked(rdvAppointmentService.acceptAlternative).mockResolvedValue(
      stubAppointmentDTO as never,
    )

    const res = await acceptPOST(makeReq("POST"), makeParams())
    expect(res.status).toBe(200)
    assertSecurityHeaders(res, "accept-alt 200")
  })

  it("403 forbidden gate → 4 headers présents", async () => {
    vi.mocked(appointmentRouteGate).mockResolvedValue(stubGateForbidden as never)

    const res = await acceptPOST(makeReq("POST"), makeParams())
    expect(res.status).toBe(403)
    assertSecurityHeaders(res, "accept-alt 403")
  })
})

describe("HSA-2-2 — POST /confirm headers", () => {
  it("200 succès → 4 headers présents", async () => {
    vi.mocked(appointmentRouteGate).mockResolvedValue(stubGateOk as never)
    vi.mocked(rdvAppointmentService.confirm).mockResolvedValue(stubAppointmentDTO as never)

    const res = await confirmPOST(makeReq("POST"), makeParams())
    expect(res.status).toBe(200)
    assertSecurityHeaders(res, "confirm 200")
  })

  it("403 forbidden gate → 4 headers présents", async () => {
    vi.mocked(appointmentRouteGate).mockResolvedValue(stubGateForbidden as never)

    const res = await confirmPOST(makeReq("POST"), makeParams())
    expect(res.status).toBe(403)
    assertSecurityHeaders(res, "confirm 403")
  })
})

/**
 * Fix régression iter 6 — POST /api/appointments (création) avait aussi été
 * oublié dans HSA-2-1/2 round 2. Maintenant couvert par helper factorisé.
 */
describe("HSA-2-1 corollaire — POST /api/appointments (création) headers", () => {
  it("201 création réussie → 4 headers présents (PHI déchiffré dans response)", async () => {
    vi.mocked(rdvAppointmentService.create).mockResolvedValue(stubAppointmentDTO as never)

    const validBody = {
      patientId: 7,
      memberId: 1,
      date: "2026-05-25",
      hour: "09:30",
      durationMinutes: 30,
      location: "in_person",
      type: "diabeto",
    }
    const res = await createPOST(makeReq("POST", validBody))
    expect(res.status).toBe(201)
    assertSecurityHeaders(res, "create 201")
  })

  it("400 validation failed → 4 headers présents", async () => {
    const res = await createPOST(
      makeReq("POST", { patientId: -1 }), // invalid
    )
    expect(res.status).toBe(400)
    assertSecurityHeaders(res, "create 400")
  })

  /**
   * Fix HSA-8 round 1 review PR #434 — couverture des paths 403/422/500
   * (absents du test initial PR #434 round 0). Tous les paths return du
   * POST DOIVENT passer par `setAppointmentSecurityHeaders` — defense-in-depth
   * vs régression future.
   */
  it("HSA-8 round 1 — 403 forbidden (canAccessPatient refuse) → 4 headers présents", async () => {
    const { canAccessPatient } = await import("@/lib/access-control")
    vi.mocked(canAccessPatient).mockResolvedValueOnce(false)

    const validBody = {
      patientId: 7,
      memberId: 1,
      date: "2026-05-25",
      hour: "09:30",
      durationMinutes: 30,
      location: "in_person",
      type: "diabeto",
    }
    const res = await createPOST(makeReq("POST", validBody))
    expect(res.status).toBe(403)
    assertSecurityHeaders(res, "create 403 (canAccess)")
  })

  it("HSA-8 round 1 — 422 gdprConsentRequired → 4 headers présents", async () => {
    const { patientShareConsent } = await import("@/lib/consent")
    vi.mocked(patientShareConsent).mockResolvedValueOnce({
      ok: false,
      error: "gdprConsentRequired",
      status: 422,
    } as never)

    const validBody = {
      patientId: 7,
      memberId: 1,
      date: "2026-05-25",
      hour: "09:30",
      durationMinutes: 30,
      location: "in_person",
      type: "diabeto",
    }
    const res = await createPOST(makeReq("POST", validBody))
    expect(res.status).toBe(422)
    assertSecurityHeaders(res, "create 422 (consent)")
  })

  it("HSA-8 round 1 — 500 service throw → 4 headers présents (mapErrorToResponse)", async () => {
    vi.mocked(rdvAppointmentService.create).mockRejectedValueOnce(
      new Error("Prisma connection timeout"),
    )

    const validBody = {
      patientId: 7,
      memberId: 1,
      date: "2026-05-25",
      hour: "09:30",
      durationMinutes: 30,
      location: "in_person",
      type: "diabeto",
    }
    const res = await createPOST(makeReq("POST", validBody))
    expect(res.status).toBe(500)
    assertSecurityHeaders(res, "create 500")
  })
})
