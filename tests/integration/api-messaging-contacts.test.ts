/**
 * Tests integration `/api/messaging/contacts` GET (Fix HSA H2 round 1 PR #444).
 *
 * Couvre :
 *   - RBAC NURSE+ via requireRole (401 si auth manquante)
 *   - GDPR consent (403 gdprConsentRequired)
 *   - Filter canMessage : retourne uniquement patients messageables
 *   - Anonymisation displayName "Patient #N"
 *   - Cap MAX_CONTACTS_PER_QUERY (50)
 *   - Cache-Control no-store + structure response
 *   - Audit log emit
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/db/client", () => ({
  prisma: {},
}))

vi.mock("@/lib/auth", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth")>()
  return {
    ...actual,
    requireRole: vi.fn(),
  }
})
vi.mock("@/lib/gdpr", () => ({
  requireGdprConsent: vi.fn(),
}))
vi.mock("@/lib/services/patient.service", () => ({
  patientService: {
    listByDoctor: vi.fn(),
  },
}))
vi.mock("@/lib/services/messaging.service", () => ({
  canMessage: vi.fn(),
}))
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

import { requireRole, AuthError } from "@/lib/auth"
import { requireGdprConsent } from "@/lib/gdpr"
import { patientService } from "@/lib/services/patient.service"
import { canMessage } from "@/lib/services/messaging.service"
import { auditService } from "@/lib/services/audit.service"

const { GET } = await import("@/app/api/messaging/contacts/route")

function makeReq(): NextRequest {
  const headers = new Headers({
    "x-user-id": "1",
    "x-user-role": "NURSE",
    "x-request-id": "test-req",
  })
  return new NextRequest(new URL("/api/messaging/contacts", "http://test.local"), {
    method: "GET",
    headers,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("GET /api/messaging/contacts (Fix HSA H2 round 1 PR #444)", () => {
  it("401 si auth manquante", async () => {
    vi.mocked(requireRole).mockImplementation(() => {
      throw new AuthError("unauthorized", 401)
    })
    const res = await GET(makeReq())
    expect(res.status).toBe(401)
  })

  it("403 gdprConsentRequired si consent revoked", async () => {
    vi.mocked(requireRole).mockReturnValue({ id: 1, role: "NURSE" } as never)
    vi.mocked(requireGdprConsent).mockResolvedValue(false)
    const res = await GET(makeReq())
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe("gdprConsentRequired")
  })

  it("happy path : filter canMessage → 2 contacts messageables", async () => {
    vi.mocked(requireRole).mockReturnValue({ id: 1, role: "NURSE" } as never)
    vi.mocked(requireGdprConsent).mockResolvedValue(true)
    vi.mocked(patientService.listByDoctor).mockResolvedValue([
      { id: 100, userId: 1000 },
      { id: 200, userId: 2000 },
      { id: 300, userId: 3000 },
    ] as never)
    // canMessage allow patient #100 + #300, refuse #200
    vi.mocked(canMessage).mockImplementation(async (from, to) => {
      if (to === 2000) return { allowed: false, patientId: null, reason: "consentRevoked" }
      return { allowed: true, patientId: to === 1000 ? 100 : 300 }
    })

    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toHaveLength(2)
    expect(body.items[0]).toEqual({
      patientId: 100,
      userId: 1000,
      displayName: "Patient #100",
    })
    expect(body.items[1].patientId).toBe(300)
    // Patient #200 absent (canMessage refuse)
    expect(body.items.find((c: { patientId: number }) => c.patientId === 200)).toBeUndefined()
  })

  it("Cache-Control no-store + private (anti-cache préférences)", async () => {
    vi.mocked(requireRole).mockReturnValue({ id: 1, role: "NURSE" } as never)
    vi.mocked(requireGdprConsent).mockResolvedValue(true)
    vi.mocked(patientService.listByDoctor).mockResolvedValue([])
    const res = await GET(makeReq())
    expect(res.headers.get("Cache-Control")).toBe("no-store, private")
  })

  it("Audit log emit avec metadata.kind + portfolioSize + messageable", async () => {
    vi.mocked(requireRole).mockReturnValue({ id: 42, role: "NURSE" } as never)
    vi.mocked(requireGdprConsent).mockResolvedValue(true)
    vi.mocked(patientService.listByDoctor).mockResolvedValue([
      { id: 1, userId: 100 },
      { id: 2, userId: 200 },
    ] as never)
    vi.mocked(canMessage).mockResolvedValue({ allowed: true, patientId: 1 })

    await GET(makeReq())
    expect(vi.mocked(auditService.log)).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 42,
        action: "READ",
        resource: "MESSAGE",
        resourceId: "messaging-contacts",
        metadata: expect.objectContaining({
          kind: "messaging.contacts.list",
          portfolioSize: 2,
          messageable: 2,
          capped: false,
        }),
      }),
    )
  })

  it("Cap MAX_CONTACTS_PER_QUERY=50 → audit.metadata.capped=true si dépassé", async () => {
    vi.mocked(requireRole).mockReturnValue({ id: 1, role: "NURSE" } as never)
    vi.mocked(requireGdprConsent).mockResolvedValue(true)
    // 55 patients → seuls les 50 premiers checked
    const bigList = Array.from({ length: 55 }, (_, i) => ({
      id: i + 1,
      userId: (i + 1) * 10,
    }))
    vi.mocked(patientService.listByDoctor).mockResolvedValue(bigList as never)
    vi.mocked(canMessage).mockResolvedValue({ allowed: true, patientId: 1 })

    const res = await GET(makeReq())
    const body = await res.json()
    // Max 50 contacts retournés (cap)
    expect(body.items.length).toBeLessThanOrEqual(50)
    expect(vi.mocked(auditService.log)).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          portfolioSize: 55,
          capped: true,
        }),
      }),
    )
  })

  it("canMessage throw → skip silencieusement (UX dégradée vs 500)", async () => {
    vi.mocked(requireRole).mockReturnValue({ id: 1, role: "NURSE" } as never)
    vi.mocked(requireGdprConsent).mockResolvedValue(true)
    vi.mocked(patientService.listByDoctor).mockResolvedValue([
      { id: 1, userId: 100 },
      { id: 2, userId: 200 },
    ] as never)
    vi.mocked(canMessage)
      .mockImplementationOnce(async () => { throw new Error("DB transient") })
      .mockImplementationOnce(async () => ({ allowed: true, patientId: 2 }))

    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    // Patient #1 skip (canMessage throw), Patient #2 OK
    expect(body.items.length).toBe(1)
    expect(body.items[0].patientId).toBe(2)
  })
})
