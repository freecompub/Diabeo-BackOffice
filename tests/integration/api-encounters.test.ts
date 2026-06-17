/**
 * Tests des routes du mode revue de consultation (US-2605).
 *
 * Vérifie le contrat HTTP de :
 *  - POST   /api/encounters            (ouvrir/reprendre, NURSE+)
 *  - PATCH  /api/encounters/[id]/draft (brouillon, NURSE+)
 *  - POST   /api/encounters/[id]/finalize (addendum immuable, NURSE+)
 *
 * Comportements verrouillés :
 *  - RBAC NURSE+ (un rôle insuffisant → 403 via AuthError).
 *  - mapping EncounterError → statut (forbidden 403 / notFound 404 / invalidState 409).
 *  - validation Zod (corps invalide → 400 ; id invalide → 400).
 *  - finalize : ancrage `period`/`dataAsOf` posé SERVEUR (jamais le client).
 */

import { describe, expect, it, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(() => ({ id: 7, role: "NURSE" })),
  AuthError: class AuthError extends Error {
    status: number
    constructor(message: string, status = 401) {
      super(message)
      this.status = status
    }
  },
}))

const openOrResume = vi.fn()
const saveDraft = vi.fn()
const finalizeReport = vi.fn()

vi.mock("@/lib/services/encounter.service", () => ({
  encounterService: {
    openOrResume: (...a: unknown[]) => openOrResume(...a),
    saveDraft: (...a: unknown[]) => saveDraft(...a),
    finalizeReport: (...a: unknown[]) => finalizeReport(...a),
  },
  EncounterError: class EncounterError extends Error {
    constructor(public code: "forbidden" | "notFound" | "invalidState") {
      super(code)
      this.name = "EncounterError"
    }
  },
  encounterErrorStatus: (code: string) =>
    code === "forbidden" ? 403 : code === "notFound" ? 404 : 409,
}))

vi.mock("@/lib/services/audit.service", () => ({
  extractRequestContext: () => ({ ipAddress: "1.2.3.4", userAgent: "vitest", requestId: "r" }),
}))

import { requireRole, AuthError } from "@/lib/auth"
import { EncounterError } from "@/lib/services/encounter.service"
const mockedRequireRole = vi.mocked(requireRole)

const { POST: openRoute } = await import("@/app/api/encounters/route")
const { PATCH: draftRoute } = await import("@/app/api/encounters/[id]/draft/route")
const { POST: finalizeRoute } = await import("@/app/api/encounters/[id]/finalize/route")

const json = (url: string, method: string, body: unknown) =>
  new NextRequest(new URL(`http://localhost${url}`), {
    method,
    headers: { "content-type": "application/json", "x-user-id": "7", "x-user-role": "NURSE" },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  vi.clearAllMocks()
  mockedRequireRole.mockReturnValue({ id: 7, role: "NURSE" } as never)
})

describe("POST /api/encounters (open/resume)", () => {
  it("ouvre/reprend et renvoie 200 avec le brouillon", async () => {
    openOrResume.mockResolvedValue({ id: 12, patientId: 42, status: "draft", draftReport: null })
    const res = await openRoute(json("/api/encounters", "POST", { patientId: 42 }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ id: 12, patientId: 42 })
    expect(openOrResume).toHaveBeenCalledWith(42, 7, "NURSE", expect.any(Object))
  })

  it("corps invalide → 400", async () => {
    const res = await openRoute(json("/api/encounters", "POST", { patientId: -1 }))
    expect(res.status).toBe(400)
    expect(openOrResume).not.toHaveBeenCalled()
  })

  it("accès patient refusé → 403 (EncounterError forbidden)", async () => {
    openOrResume.mockRejectedValue(new EncounterError("forbidden"))
    const res = await openRoute(json("/api/encounters", "POST", { patientId: 42 }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: "forbidden" })
  })

  it("rôle insuffisant → 403 (AuthError)", async () => {
    mockedRequireRole.mockImplementation(() => { throw new AuthError("forbidden", 403) })
    const res = await openRoute(json("/api/encounters", "POST", { patientId: 42 }))
    expect(res.status).toBe(403)
  })
})

describe("PATCH /api/encounters/[id]/draft", () => {
  const params = { params: Promise.resolve({ id: "12" }) }

  it("sauvegarde le brouillon → 200 (rôle threadé pour re-check accès)", async () => {
    saveDraft.mockResolvedValue(undefined)
    const res = await draftRoute(json("/api/encounters/12/draft", "PATCH", { content: "wip" }), params)
    expect(res.status).toBe(200)
    expect(saveDraft).toHaveBeenCalledWith(12, 7, "NURSE", "wip", expect.any(Object))
  })

  it("id invalide → 400", async () => {
    const res = await draftRoute(
      json("/api/encounters/abc/draft", "PATCH", { content: "x" }),
      { params: Promise.resolve({ id: "abc" }) },
    )
    expect(res.status).toBe(400)
    expect(saveDraft).not.toHaveBeenCalled()
  })

  it("propriétaire requis → 403 (EncounterError forbidden)", async () => {
    saveDraft.mockRejectedValue(new EncounterError("forbidden"))
    const res = await draftRoute(json("/api/encounters/12/draft", "PATCH", { content: "x" }), params)
    expect(res.status).toBe(403)
  })

  it("statut ≠ draft → 409 (EncounterError invalidState)", async () => {
    saveDraft.mockRejectedValue(new EncounterError("invalidState"))
    const res = await draftRoute(json("/api/encounters/12/draft", "PATCH", { content: "x" }), params)
    expect(res.status).toBe(409)
  })
})

describe("POST /api/encounters/[id]/finalize", () => {
  const params = { params: Promise.resolve({ id: "12" }) }

  it("finalise et pose l'ancrage SERVEUR (period/dataAsOf non issus du client)", async () => {
    finalizeReport.mockResolvedValue({ reportId: 99, patientId: 42 })
    // Le client tente d'imposer son ancrage → doit être ignoré.
    const res = await finalizeRoute(
      json("/api/encounters/12/finalize", "POST", { content: "CR", period: "999d", dataAsOf: "1999-01-01" }),
      params,
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ reportId: 99 })
    const [, , role, content, anchor] = finalizeReport.mock.calls[0]
    expect(role).toBe("NURSE")
    expect(content).toBe("CR")
    expect(anchor.period).toBe("14d") // REVIEW_PERIOD serveur, pas "999d"
    expect(anchor.dataAsOf).toBeInstanceOf(Date)
  })

  it("contenu vide → 400 (Zod min 1)", async () => {
    const res = await finalizeRoute(json("/api/encounters/12/finalize", "POST", { content: "" }), params)
    expect(res.status).toBe(400)
    expect(finalizeReport).not.toHaveBeenCalled()
  })

  it("statut ≠ draft → 409 (EncounterError invalidState)", async () => {
    finalizeReport.mockRejectedValue(new EncounterError("invalidState"))
    const res = await finalizeRoute(json("/api/encounters/12/finalize", "POST", { content: "CR" }), params)
    expect(res.status).toBe(409)
  })

  it("séance absente → 404 (EncounterError notFound)", async () => {
    finalizeReport.mockRejectedValue(new EncounterError("notFound"))
    const res = await finalizeRoute(json("/api/encounters/12/finalize", "POST", { content: "CR" }), params)
    expect(res.status).toBe(404)
  })

  it("erreur inattendue → 500 serverError (pas de fuite)", async () => {
    finalizeReport.mockRejectedValue(new Error("boom"))
    const res = await finalizeRoute(json("/api/encounters/12/finalize", "POST", { content: "CR" }), params)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: "serverError" })
  })
})
