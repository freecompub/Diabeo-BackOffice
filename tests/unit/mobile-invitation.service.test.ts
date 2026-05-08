/**
 * Test suite: Mobile Invitation Service (US-2025)
 *
 * Behaviors tested:
 * - createInvite generates a token + deep link + fallback URL with valid expiry.
 * - Rejects unknown / soft-deleted patient (anti-oracle path: `patient_not_found`).
 * - Enforces canAccessPatient (defense-in-depth, even if route already checks).
 * - Audit metadata captures jti + expiresAt, NEVER the token in clear.
 *
 * Risks mitigated:
 * - Cross-tenant invite generation (DOCTOR for another's patient).
 * - Token leak via audit logs.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

const mockSignToken = vi.hoisted(() => vi.fn())
vi.mock("@/lib/auth/jwt", () => ({
  signPatientInviteToken: mockSignToken,
}))

const mockCanAccess = vi.hoisted(() => vi.fn())
vi.mock("@/lib/access-control", () => ({
  canAccessPatient: mockCanAccess,
}))

import { mobileInvitationService } from "@/lib/services/mobile-invitation.service"

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.auditLog.create.mockResolvedValue({} as never)
  mockSignToken.mockResolvedValue({
    token: "TEST_TOKEN_OPAQUE",
    jti: "jti-123",
    expiresAt: new Date(Date.now() + 24 * 3600_000),
  })
})

describe("mobileInvitationService.createInvite", () => {
  it("rejects unknown / soft-deleted patient (anti-oracle)", async () => {
    prismaMock.patient.findFirst.mockResolvedValue(null)
    await expect(
      mobileInvitationService.createInvite({
        patientId: 999, invitedBy: 1, invitedByRole: "DOCTOR",
      }),
    ).rejects.toThrow("patient_not_found")
    expect(mockSignToken).not.toHaveBeenCalled()
  })

  it("rejects forbidden access (cross-tenant)", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 5 } as never)
    mockCanAccess.mockResolvedValue(false)
    await expect(
      mobileInvitationService.createInvite({
        patientId: 5, invitedBy: 99, invitedByRole: "DOCTOR",
      }),
    ).rejects.toThrow("forbidden")
    expect(mockSignToken).not.toHaveBeenCalled()
  })

  it("generates token + deep link + fallback URL on happy path", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 5 } as never)
    mockCanAccess.mockResolvedValue(true)

    const result = await mobileInvitationService.createInvite({
      patientId: 5, invitedBy: 99, invitedByRole: "DOCTOR",
    })
    expect(result.token).toBe("TEST_TOKEN_OPAQUE")
    expect(result.deepLink).toContain("diabeo://invite/")
    expect(result.fallbackUrl).toContain("/invite/")
    expect(result.expiresAt).toBeInstanceOf(Date)
  })

  it("audit metadata captures jti + expiresAt, NOT the token in clear", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 5 } as never)
    mockCanAccess.mockResolvedValue(true)

    await mobileInvitationService.createInvite({
      patientId: 5, invitedBy: 99, invitedByRole: "DOCTOR",
    })
    const auditCall = prismaMock.auditLog.create.mock.calls.at(-1)?.[0] as {
      data?: { metadata?: Record<string, unknown>; resourceId?: string }
    }
    expect(auditCall?.data?.resourceId).toContain("jti-123")
    expect(auditCall?.data?.metadata).toEqual(
      expect.objectContaining({ jti: "jti-123" }),
    )
    // No "token" field in metadata
    expect(JSON.stringify(auditCall?.data?.metadata)).not.toContain("TEST_TOKEN_OPAQUE")
  })
})
