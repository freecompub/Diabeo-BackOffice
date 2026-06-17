/**
 * Tests des routes de gestion des membres de cabinet (US-2610).
 *  - GET/POST /api/cabinet/[id]/members
 *  - PATCH/DELETE /api/cabinet/[id]/members/[userId]
 *
 * Verrouille le contrat HTTP : auth, validation Zod, mapping OrgMembershipError
 * → statut (forbidden 403 / notFound 404 / invalidState|selfElevation 409).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(() => ({ id: 7, role: "DOCTOR" })),
  AuthError: class AuthError extends Error {
    status: number
    constructor(m: string, s = 401) { super(m); this.status = s }
  },
}))
const listMembers = vi.fn()
const inviteMember = vi.fn()
const setCapabilities = vi.fn()
const revokeMember = vi.fn()
vi.mock("@/lib/services/org-membership.service", () => ({
  orgMembershipService: {
    listMembers: (...a: unknown[]) => listMembers(...a),
    inviteMember: (...a: unknown[]) => inviteMember(...a),
    setCapabilities: (...a: unknown[]) => setCapabilities(...a),
    revokeMember: (...a: unknown[]) => revokeMember(...a),
  },
  OrgMembershipError: class OrgMembershipError extends Error {
    constructor(public code: string) { super(code); this.name = "OrgMembershipError" }
  },
  orgMembershipErrorStatus: (code: string) =>
    code === "forbidden" ? 403 : code === "notFound" ? 404 : 409,
}))
vi.mock("@/lib/services/audit.service", () => ({
  extractRequestContext: () => ({ ipAddress: "1.2.3.4", userAgent: "vitest", requestId: "r" }),
}))

import { OrgMembershipError } from "@/lib/services/org-membership.service"
const { GET, POST } = await import("@/app/api/cabinet/[id]/members/route")
const { PATCH, DELETE } = await import("@/app/api/cabinet/[id]/members/[userId]/route")

const req = (url: string, method: string, body?: unknown) =>
  new NextRequest(new URL(`http://localhost${url}`), {
    method,
    headers: { "content-type": "application/json", "x-user-id": "7", "x-user-role": "DOCTOR" },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  })

const p = (id: string) => ({ params: Promise.resolve({ id }) })
const pu = (id: string, userId: string) => ({ params: Promise.resolve({ id, userId }) })

beforeEach(() => vi.clearAllMocks())

describe("GET /api/cabinet/[id]/members", () => {
  it("liste → 200", async () => {
    listMembers.mockResolvedValue([{ userId: 5 }])
    const res = await GET(req("/api/cabinet/9/members", "GET"), p("9"))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ members: [{ userId: 5 }] })
    expect(listMembers).toHaveBeenCalledWith(7, "DOCTOR", 9, expect.any(Object))
  })
  it("id invalide → 400", async () => {
    const res = await GET(req("/api/cabinet/abc/members", "GET"), p("abc"))
    expect(res.status).toBe(400)
  })
  it("sans Q2 → 403 (forbidden)", async () => {
    listMembers.mockRejectedValue(new OrgMembershipError("forbidden"))
    const res = await GET(req("/api/cabinet/9/members", "GET"), p("9"))
    expect(res.status).toBe(403)
  })
})

describe("POST /api/cabinet/[id]/members (invite)", () => {
  it("invite → 201 réponse NEUTRE (anti-énumération : pas d'userId/invitedNewUser)", async () => {
    inviteMember.mockResolvedValue({ userId: 50, invitedNewUser: true })
    const res = await POST(req("/api/cabinet/9/members", "POST", { email: "n@x.fr", clinicalRole: "NURSE" }), p("9"))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ ok: true })
  })
  it("corps invalide (email) → 400", async () => {
    const res = await POST(req("/api/cabinet/9/members", "POST", { email: "nope" }), p("9"))
    expect(res.status).toBe(400)
    expect(inviteMember).not.toHaveBeenCalled()
  })
  it("déjà membre → 409 (invalidState)", async () => {
    inviteMember.mockRejectedValue(new OrgMembershipError("invalidState"))
    const res = await POST(req("/api/cabinet/9/members", "POST", { email: "e@x.fr", clinicalRole: "DOCTOR" }), p("9"))
    expect(res.status).toBe(409)
  })
})

describe("PATCH /api/cabinet/[id]/members/[userId]", () => {
  it("modifie capacités → 200", async () => {
    setCapabilities.mockResolvedValue(undefined)
    const res = await PATCH(req("/api/cabinet/9/members/5", "PATCH", { canManage: true }), pu("9", "5"))
    expect(res.status).toBe(200)
    expect(setCapabilities).toHaveBeenCalledWith(7, "DOCTOR", 5, 9, { canManage: true }, expect.any(Object))
  })
  it("corps vide → 400 (noCapabilityProvided)", async () => {
    const res = await PATCH(req("/api/cabinet/9/members/5", "PATCH", {}), pu("9", "5"))
    expect(res.status).toBe(400)
  })
  it("auto-modification → 409 (selfElevation)", async () => {
    setCapabilities.mockRejectedValue(new OrgMembershipError("selfElevation"))
    const res = await PATCH(req("/api/cabinet/9/members/7", "PATCH", { canManage: true }), pu("9", "7"))
    expect(res.status).toBe(409)
  })
})

describe("DELETE /api/cabinet/[id]/members/[userId]", () => {
  it("retire → 200", async () => {
    revokeMember.mockResolvedValue(undefined)
    const res = await DELETE(req("/api/cabinet/9/members/5", "DELETE"), pu("9", "5"))
    expect(res.status).toBe(200)
  })
  it("dernier principal → 409 (lastPrincipalAdmin)", async () => {
    revokeMember.mockRejectedValue(new OrgMembershipError("lastPrincipalAdmin"))
    const res = await DELETE(req("/api/cabinet/9/members/5", "DELETE"), pu("9", "5"))
    expect(res.status).toBe(409)
  })
  it("membre inexistant → 404", async () => {
    revokeMember.mockRejectedValue(new OrgMembershipError("notFound"))
    const res = await DELETE(req("/api/cabinet/9/members/5", "DELETE"), pu("9", "5"))
    expect(res.status).toBe(404)
  })
})
