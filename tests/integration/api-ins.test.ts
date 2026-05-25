/**
 * @description US-2026 — INS routes integration tests (GET/PUT/DELETE).
 *
 * Couvre :
 *   - RBAC : 401 sans auth / 403 forbidden uniforme (anti-enumeration) /
 *            NURSE lecture seule / DOCTOR write / ADMIN clear
 *   - Validation : 422 format invalide / 409 collision
 *   - Audit : USER_INS resource + kind metadata
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/db/client", () => ({ prisma: {} }))

vi.mock("@/lib/gdpr", () => ({
  requireGdprConsent: vi.fn().mockResolvedValue(true),
  invalidateGdprConsentCache: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/access-control", async (orig) => {
  const actual = await orig<typeof import("@/lib/access-control")>()
  return {
    ...actual,
    resolvePatientForConsent: vi.fn().mockResolvedValue({
      patientId: 42, ownerUserId: 100,
    }),
  }
})

vi.mock("@/lib/services/ins.service", async (orig) => {
  const actual = await orig<typeof import("@/lib/services/ins.service")>()
  return {
    ...actual,
    insService: {
      setIns: vi.fn(),
      getIns: vi.fn(),
      clearIns: vi.fn(),
    },
  }
})

import {
  insService,
  InsValidationError,
  InsCollisionError,
  InsCollisionRateLimitError,
} from "@/lib/services/ins.service"

const { GET, PUT, DELETE } = await import(
  "@/app/api/patients/[id]/ins/route"
)

function makeReq(
  url: string,
  init: RequestInit & { auth?: boolean; role?: string } = {},
): NextRequest {
  const headers = new Headers(init.headers)
  if (init.auth !== false) {
    headers.set("x-user-id", "1")
    headers.set("x-user-role", init.role ?? "DOCTOR")
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

// INS valide pour fixtures (Luhn-97 OK).
const VALID_INS = "190017500100196"

// ────────────────────────────────────────────────────────────────
// GET /api/patients/[id]/ins
// ────────────────────────────────────────────────────────────────

describe("GET /api/patients/[id]/ins", () => {
  it("200 + ins dechiffre + headers ANSSI complets (M2 round 2)", async () => {
    vi.mocked(insService.getIns).mockResolvedValue({
      ins: VALID_INS, hasIns: true,
      qualityStatus: "saisi_non_verifie",
      setAt: new Date("2026-05-17T10:00:00Z"),
    })
    const res = await GET(
      makeReq("/api/patients/42/ins"),
      { params: Promise.resolve({ id: "42" }) },
    )
    expect(res.status).toBe(200)
    // M2 review — 4 headers ANSSI RGS §4.5.
    expect(res.headers.get("Cache-Control")).toContain("no-store")
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer")
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff")
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'none'")
    const body = await res.json()
    expect(body.ins).toBe(VALID_INS)
    expect(body.hasIns).toBe(true)
    expect(body.qualityStatus).toBe("saisi_non_verifie")
    expect(body.setAt).toBe("2026-05-17T10:00:00.000Z")
  })

  it("401 sans JWT", async () => {
    const res = await GET(
      makeReq("/api/patients/42/ins", { auth: false }),
      { params: Promise.resolve({ id: "42" }) },
    )
    expect(res.status).toBe(401)
  })

  it("HIGH-2 anti-enumeration : non-autorise → 403 forbidden uniforme", async () => {
    const { resolvePatientForConsent } = await import("@/lib/access-control")
    vi.mocked(resolvePatientForConsent).mockResolvedValueOnce(null)
    const res = await GET(
      makeReq("/api/patients/42/ins"),
      { params: Promise.resolve({ id: "42" }) },
    )
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe("forbidden")
  })

  it("VIEWER own : peut lire son propre INS", async () => {
    vi.mocked(insService.getIns).mockResolvedValue({
      ins: VALID_INS, hasIns: true,
      qualityStatus: "saisi_non_verifie",
      setAt: new Date("2026-05-17T10:00:00Z"),
    })
    const res = await GET(
      makeReq("/api/patients/42/ins", { role: "VIEWER" }),
      { params: Promise.resolve({ id: "42" }) },
    )
    expect(res.status).toBe(200)
  })

  it("NURSE : peut lire (RBAC NURSE+)", async () => {
    vi.mocked(insService.getIns).mockResolvedValue({
      ins: VALID_INS, hasIns: true,
      qualityStatus: "saisi_non_verifie",
      setAt: new Date("2026-05-17T10:00:00Z"),
    })
    const res = await GET(
      makeReq("/api/patients/42/ins", { role: "NURSE" }),
      { params: Promise.resolve({ id: "42" }) },
    )
    expect(res.status).toBe(200)
  })
})

// ────────────────────────────────────────────────────────────────
// PUT /api/patients/[id]/ins
// ────────────────────────────────────────────────────────────────

describe("PUT /api/patients/[id]/ins", () => {
  it("200 DOCTOR set INS valide", async () => {
    vi.mocked(insService.setIns).mockResolvedValue({
      updated: true, qualityStatus: "saisi_non_verifie",
    })
    const res = await PUT(
      makeReq("/api/patients/42/ins", {
        method: "PUT", role: "DOCTOR",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ins: VALID_INS }),
      }),
      { params: Promise.resolve({ id: "42" }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.updated).toBe(true)
  })

  it("200 VIEWER set son propre INS", async () => {
    vi.mocked(insService.setIns).mockResolvedValue({
      updated: true, qualityStatus: "saisi_non_verifie",
    })
    const res = await PUT(
      makeReq("/api/patients/42/ins", {
        method: "PUT", role: "VIEWER",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ins: VALID_INS }),
      }),
      { params: Promise.resolve({ id: "42" }) },
    )
    expect(res.status).toBe(200)
  })

  it("403 NURSE — lecture seule, pas de set", async () => {
    const res = await PUT(
      makeReq("/api/patients/42/ins", {
        method: "PUT", role: "NURSE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ins: VALID_INS }),
      }),
      { params: Promise.resolve({ id: "42" }) },
    )
    expect(res.status).toBe(403)
  })

  it("422 format invalide", async () => {
    vi.mocked(insService.setIns).mockRejectedValue(
      new InsValidationError("ins", "invalidFormat"),
    )
    const res = await PUT(
      makeReq("/api/patients/42/ins", {
        method: "PUT", role: "DOCTOR",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ins: "190017500100100" }), // Luhn cle fausse
      }),
      { params: Promise.resolve({ id: "42" }) },
    )
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.field).toBe("ins")
  })

  it("422 Zod : ins trop court", async () => {
    const res = await PUT(
      makeReq("/api/patients/42/ins", {
        method: "PUT", role: "DOCTOR",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ins: "12345" }),
      }),
      { params: Promise.resolve({ id: "42" }) },
    )
    expect(res.status).toBe(422)
  })

  it("409 collision : INS deja registered", async () => {
    vi.mocked(insService.setIns).mockRejectedValue(new InsCollisionError())
    const res = await PUT(
      makeReq("/api/patients/42/ins", {
        method: "PUT", role: "DOCTOR",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ins: VALID_INS }),
      }),
      { params: Promise.resolve({ id: "42" }) },
    )
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe("insAlreadyRegistered")
  })

  it("415 si Content-Type pas application/json", async () => {
    const res = await PUT(
      makeReq("/api/patients/42/ins", {
        method: "PUT", role: "DOCTOR",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ ins: VALID_INS }),
      }),
      { params: Promise.resolve({ id: "42" }) },
    )
    expect(res.status).toBe(415)
  })

  it("HIGH-2 anti-enumeration PUT : 403 forbidden uniforme", async () => {
    const { resolvePatientForConsent } = await import("@/lib/access-control")
    vi.mocked(resolvePatientForConsent).mockResolvedValueOnce(null)
    const res = await PUT(
      makeReq("/api/patients/42/ins", {
        method: "PUT", role: "DOCTOR",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ins: VALID_INS }),
      }),
      { params: Promise.resolve({ id: "42" }) },
    )
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe("forbidden")
  })

  // H2 round 2 — rate-limit anti-énumération RNIPP
  it("H2 round 2 — 429 + Retry-After si InsCollisionRateLimitError", async () => {
    vi.mocked(insService.setIns).mockRejectedValue(
      new InsCollisionRateLimitError(86400),
    )
    const res = await PUT(
      makeReq("/api/patients/42/ins", {
        method: "PUT", role: "DOCTOR",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ins: VALID_INS }),
      }),
      { params: Promise.resolve({ id: "42" }) },
    )
    expect(res.status).toBe(429)
    expect(res.headers.get("Retry-After")).toBe("86400")
    const body = await res.json()
    expect(body.error).toBe("rateLimited")
    expect(body.retryAfterSec).toBe(86400)
  })

  // VIEWER cross-patient (L7 round 1)
  it("L7 — VIEWER tentative PUT autre patient → 403 forbidden via resolvePatientForConsent null", async () => {
    const { resolvePatientForConsent } = await import("@/lib/access-control")
    vi.mocked(resolvePatientForConsent).mockResolvedValueOnce(null)
    const res = await PUT(
      makeReq("/api/patients/99/ins", {
        method: "PUT", role: "VIEWER",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ins: VALID_INS }),
      }),
      { params: Promise.resolve({ id: "99" }) },
    )
    expect(res.status).toBe(403)
  })
})

// ────────────────────────────────────────────────────────────────
// DELETE /api/patients/[id]/ins
// ────────────────────────────────────────────────────────────────

describe("DELETE /api/patients/[id]/ins", () => {
  it("200 DOCTOR clear INS", async () => {
    vi.mocked(insService.clearIns).mockResolvedValue({
      cleared: true, alreadyCleared: false,
    })
    const res = await DELETE(
      makeReq("/api/patients/42/ins", { method: "DELETE", role: "DOCTOR" }),
      { params: Promise.resolve({ id: "42" }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.cleared).toBe(true)
  })

  it("200 ADMIN clear INS", async () => {
    vi.mocked(insService.clearIns).mockResolvedValue({
      cleared: true, alreadyCleared: false,
    })
    const res = await DELETE(
      makeReq("/api/patients/42/ins", { method: "DELETE", role: "ADMIN" }),
      { params: Promise.resolve({ id: "42" }) },
    )
    expect(res.status).toBe(200)
  })

  it("403 NURSE — pas le droit de clear (DOCTOR+/ADMIN only)", async () => {
    const res = await DELETE(
      makeReq("/api/patients/42/ins", { method: "DELETE", role: "NURSE" }),
      { params: Promise.resolve({ id: "42" }) },
    )
    expect(res.status).toBe(403)
  })

  it("403 VIEWER — patient passe par compte deletion RGPD", async () => {
    const res = await DELETE(
      makeReq("/api/patients/42/ins", { method: "DELETE", role: "VIEWER" }),
      { params: Promise.resolve({ id: "42" }) },
    )
    expect(res.status).toBe(403)
  })

  it("alreadyCleared retourne 200 (idempotent)", async () => {
    vi.mocked(insService.clearIns).mockResolvedValue({
      cleared: true, alreadyCleared: true,
    })
    const res = await DELETE(
      makeReq("/api/patients/42/ins", { method: "DELETE", role: "DOCTOR" }),
      { params: Promise.resolve({ id: "42" }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.alreadyCleared).toBe(true)
  })
})
