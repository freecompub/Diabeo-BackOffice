/**
 * Test — POST /api/dashboard/recall (D6, traçabilité HDS des relances).
 *
 * Comportement clinique/conformité testé : le clic « Appeler »/« SMS » d'une
 * relance écrit un AuditLog `RECALL_INITIATED` scopé patient. Gardes : RBAC
 * (requireRole NURSE), validation Zod (patientId + channel tel/sms), anti-IDOR
 * (canAccessPatient → 403 + accessDenied si hors périmètre). Risque couvert :
 * un geste de contact patient non tracé (trou HDS) OU tracé pour un patient
 * hors périmètre (fuite forensique).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
  AuthError: class AuthError extends Error {
    status: number
    constructor(message: string, status: number) {
      super(message)
      this.status = status
    }
  },
}))
vi.mock("@/lib/access-control", () => ({ canAccessPatient: vi.fn() }))
vi.mock("@/lib/services/audit.service", () => ({
  auditService: { log: vi.fn(), accessDenied: vi.fn() },
  extractRequestContext: vi.fn(() => ({ ipAddress: "i", userAgent: "u", requestId: "r" })),
}))

import { POST } from "@/app/api/dashboard/recall/route"
import { requireRole, AuthError } from "@/lib/auth"
import { canAccessPatient } from "@/lib/access-control"
import { auditService } from "@/lib/services/audit.service"

const mRole = vi.mocked(requireRole)
const mAccess = vi.mocked(canAccessPatient)
const mLog = vi.mocked(auditService.log)
const mDenied = vi.mocked(auditService.accessDenied)

const makeReq = (body: unknown) => ({ json: async () => body }) as never

beforeEach(() => {
  vi.clearAllMocks()
  mRole.mockReturnValue({ id: 7, role: "NURSE" } as never)
  mAccess.mockResolvedValue(true)
  mLog.mockResolvedValue(undefined as never)
  mDenied.mockResolvedValue(undefined as never)
})

describe("POST /api/dashboard/recall — traçabilité relance (D6)", () => {
  it("audite une relance tel valide (201, RECALL_INITIATED, pivot patientId)", async () => {
    const r = await POST(makeReq({ patientId: 42, channel: "tel" }))
    expect(r.status).toBe(201)
    expect(mLog).toHaveBeenCalledTimes(1)
    const entry = mLog.mock.calls[0]![0]
    expect(entry.action).toBe("RECALL_INITIATED")
    expect(entry.resource).toBe("PATIENT")
    expect(entry.resourceId).toBe("42")
    expect(entry.metadata).toMatchObject({ patientId: 42, channel: "tel" })
  })

  it("accepte le canal sms", async () => {
    const r = await POST(makeReq({ patientId: 1, channel: "sms" }))
    expect(r.status).toBe(201)
    expect(mLog.mock.calls[0]![0].metadata).toMatchObject({ channel: "sms" })
  })

  it("rejette un body invalide (400) sans auditer", async () => {
    const r = await POST(makeReq({ patientId: 42, channel: "email" }))
    expect(r.status).toBe(400)
    expect(mLog).not.toHaveBeenCalled()
  })

  it("rejette un patientId manquant (400)", async () => {
    const r = await POST(makeReq({ channel: "tel" }))
    expect(r.status).toBe(400)
    expect(mLog).not.toHaveBeenCalled()
  })

  it("anti-IDOR : patient hors périmètre → 403 + accessDenied, pas de RECALL", async () => {
    mAccess.mockResolvedValue(false)
    const r = await POST(makeReq({ patientId: 999, channel: "tel" }))
    expect(r.status).toBe(403)
    expect(mDenied).toHaveBeenCalledTimes(1)
    expect(mLog).not.toHaveBeenCalled()
  })

  it("propage l'erreur RBAC (403 requireRole)", async () => {
    mRole.mockImplementation(() => {
      throw new AuthError("forbidden", 403)
    })
    const r = await POST(makeReq({ patientId: 42, channel: "tel" }))
    expect(r.status).toBe(403)
    expect(mLog).not.toHaveBeenCalled()
  })
})
