/**
 * Test suite : org-membership.service (US-2610 — gestion personnel & droits).
 *
 * Couvre les règles RBAC capacité (2 axes) :
 *  - accès gestion = Q2 (canManage) dans le scope (ADMIN bypass) ;
 *  - octroi Q2 = principal-admin ; isPrincipalAdmin = ADMIN only ;
 *  - non-auto-élévation ; anti-self-lockout (dernier principal) ;
 *  - invite (user existant/nouveau) ; révocation immédiate (bump + invalidate).
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

vi.mock("@/lib/capabilities", () => ({
  canManageOrg: vi.fn(),
  isPrincipalAdmin: vi.fn(),
}))
vi.mock("@/lib/auth/session", () => ({ invalidateAllUserSessions: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/services/email.service", () => ({
  emailService: { sendStaffInvitation: vi.fn().mockResolvedValue({ ok: true }) },
}))
vi.mock("@/lib/crypto/fields", () => ({
  encryptField: (v: string) => `enc:${v}`,
  safeDecryptField: (v: string | null) => (v ? v.replace(/^enc:/, "dec:") : v),
}))
vi.mock("@/lib/crypto/hmac", () => ({
  hmacEmail: (v: string) => `hmac:${v}`,
  hmacField: (v: string) => `hmacf:${v}`,
}))
vi.mock("bcryptjs", () => ({ hash: vi.fn().mockResolvedValue("hashed") }))

import { orgMembershipService } from "@/lib/services/org-membership.service"
import { canManageOrg, isPrincipalAdmin } from "@/lib/capabilities"
import { invalidateAllUserSessions } from "@/lib/auth/session"
import { emailService } from "@/lib/services/email.service"

const mCanManage = vi.mocked(canManageOrg)
const mPrincipal = vi.mocked(isPrincipalAdmin)
const pm = prismaMock as unknown as {
  healthcareMembership: { findMany: any; findUnique: any; create: any; update: any; delete: any; count: any }
  user: { findUnique: any; create: any; update: any }
  verificationToken: { deleteMany: any; create: any }
  auditLog: { create: any }
  $transaction: any
}

beforeEach(() => {
  vi.clearAllMocks()
  mCanManage.mockResolvedValue(true)
  mPrincipal.mockResolvedValue(true)
  prismaMock.auditLog.create.mockResolvedValue({} as any)
  pm.$transaction.mockImplementation((cb: any) => cb(prismaMock))
})

describe("assertCanManage (accès gestion)", () => {
  it("non-ADMIN sans Q2 → forbidden", async () => {
    mCanManage.mockResolvedValue(false)
    await expect(orgMembershipService.listMembers(1, "NURSE", 9)).rejects.toMatchObject({ code: "forbidden" })
  })
  it("ADMIN bypass (pas de check canManage)", async () => {
    pm.healthcareMembership.findMany.mockResolvedValue([])
    await orgMembershipService.listMembers(1, "ADMIN", 9)
    expect(mCanManage).not.toHaveBeenCalled()
  })
})

describe("listMembers", () => {
  it("renvoie les membres avec PII déchiffrée + capacités", async () => {
    pm.healthcareMembership.findMany.mockResolvedValue([
      {
        userId: 5, clinicalRole: "DOCTOR", canManage: true, isPrincipalAdmin: false,
        user: { firstname: "enc:Marie", lastname: "enc:Martin", email: "enc:m@x.fr", status: "active" },
      },
    ])
    const out = await orgMembershipService.listMembers(1, "DOCTOR", 9)
    expect(out[0]).toMatchObject({
      userId: 5, firstname: "dec:Marie", clinicalRole: "DOCTOR", canManage: true, psVerified: true,
    })
  })
})

describe("inviteMember", () => {
  it("nouveau user → crée user + token + membership + email d'invitation", async () => {
    pm.user.findUnique.mockResolvedValue(null)
    pm.user.create.mockResolvedValue({ id: 50 })
    pm.healthcareMembership.create.mockResolvedValue({ id: 1 })
    const r = await orgMembershipService.inviteMember(1, "DOCTOR", 9, { email: "n@x.fr", clinicalRole: "NURSE" })
    expect(r).toEqual({ userId: 50, invitedNewUser: true })
    expect(pm.user.create.mock.calls[0][0].data.role).toBe("NURSE")
    expect(pm.verificationToken.create).toHaveBeenCalled()
    expect(pm.healthcareMembership.create).toHaveBeenCalled()
    expect(emailService.sendStaffInvitation).toHaveBeenCalledWith("n@x.fr", expect.any(String))
  })

  it("user existant → rattache (pas de création/email)", async () => {
    pm.user.findUnique.mockResolvedValue({ id: 7 })
    pm.healthcareMembership.findUnique.mockResolvedValue(null) // pas encore membre
    pm.healthcareMembership.create.mockResolvedValue({ id: 2 })
    const r = await orgMembershipService.inviteMember(1, "DOCTOR", 9, { email: "e@x.fr", clinicalRole: "DOCTOR" })
    expect(r).toEqual({ userId: 7, invitedNewUser: false })
    expect(pm.user.create).not.toHaveBeenCalled()
    expect(emailService.sendStaffInvitation).not.toHaveBeenCalled()
  })

  it("déjà membre → invalidState", async () => {
    pm.user.findUnique.mockResolvedValue({ id: 7 })
    pm.healthcareMembership.findUnique.mockResolvedValue({ id: 99 })
    await expect(
      orgMembershipService.inviteMember(1, "DOCTOR", 9, { email: "e@x.fr", clinicalRole: "DOCTOR" }),
    ).rejects.toMatchObject({ code: "invalidState" })
  })

  it("octroi canManage par non-principal → forbidden", async () => {
    mPrincipal.mockResolvedValue(false)
    await expect(
      orgMembershipService.inviteMember(1, "NURSE", 9, { email: "e@x.fr", clinicalRole: "NURSE", canManage: true }),
    ).rejects.toMatchObject({ code: "forbidden" })
  })

  it("octroi isPrincipalAdmin par non-ADMIN → forbidden", async () => {
    await expect(
      orgMembershipService.inviteMember(1, "DOCTOR", 9, { email: "e@x.fr", clinicalRole: "NURSE", isPrincipalAdmin: true }),
    ).rejects.toMatchObject({ code: "forbidden" })
  })
})

describe("setCapabilities", () => {
  beforeEach(() => {
    pm.healthcareMembership.findUnique.mockResolvedValue({ id: 1 })
    pm.healthcareMembership.update.mockResolvedValue({})
    pm.user.update.mockResolvedValue({})
  })

  it("modifie les capacités + bump authVersion + invalide les sessions (immédiat)", async () => {
    await orgMembershipService.setCapabilities(1, "DOCTOR", 5, 9, { canManage: true })
    expect(pm.healthcareMembership.update.mock.calls[0][0].data).toMatchObject({ canManage: true })
    expect(pm.user.update.mock.calls[0][0].data).toEqual({ authVersion: { increment: 1 } })
    expect(invalidateAllUserSessions).toHaveBeenCalledWith(5)
  })

  it("auto-modification → selfElevation", async () => {
    await expect(orgMembershipService.setCapabilities(5, "DOCTOR", 5, 9, { canManage: true }))
      .rejects.toMatchObject({ code: "selfElevation" })
  })

  it("canManage par non-principal → forbidden", async () => {
    mPrincipal.mockResolvedValue(false)
    await expect(orgMembershipService.setCapabilities(1, "NURSE", 5, 9, { canManage: true }))
      .rejects.toMatchObject({ code: "forbidden" })
  })

  it("isPrincipalAdmin par non-ADMIN → forbidden", async () => {
    await expect(orgMembershipService.setCapabilities(1, "DOCTOR", 5, 9, { isPrincipalAdmin: true }))
      .rejects.toMatchObject({ code: "forbidden" })
  })

  it("membre inexistant → notFound", async () => {
    pm.healthcareMembership.findUnique.mockResolvedValue(null)
    await expect(orgMembershipService.setCapabilities(1, "ADMIN", 5, 9, { clinicalRole: "DOCTOR" }))
      .rejects.toMatchObject({ code: "notFound" })
  })

  it("rétrograder le DERNIER admin principal → lastPrincipalAdmin (HIGH review)", async () => {
    pm.healthcareMembership.findUnique.mockResolvedValue({ id: 1, isPrincipalAdmin: true })
    pm.healthcareMembership.count.mockResolvedValue(0) // aucun autre principal
    await expect(orgMembershipService.setCapabilities(1, "ADMIN", 5, 9, { isPrincipalAdmin: false }))
      .rejects.toMatchObject({ code: "lastPrincipalAdmin" })
    expect(pm.healthcareMembership.update).not.toHaveBeenCalled()
  })

  it("cohérence : isPrincipalAdmin=true force canManage=true", async () => {
    pm.healthcareMembership.findUnique.mockResolvedValue({ id: 1, isPrincipalAdmin: false })
    pm.healthcareMembership.update.mockResolvedValue({})
    pm.user.update.mockResolvedValue({})
    await orgMembershipService.setCapabilities(1, "ADMIN", 5, 9, { isPrincipalAdmin: true })
    expect(pm.healthcareMembership.update.mock.calls[0][0].data).toMatchObject({
      isPrincipalAdmin: true, canManage: true,
    })
  })

  it("cohérence : isPrincipalAdmin=true + canManage=false → invalidState", async () => {
    pm.healthcareMembership.findUnique.mockResolvedValue({ id: 1, isPrincipalAdmin: false })
    await expect(
      orgMembershipService.setCapabilities(1, "ADMIN", 5, 9, { isPrincipalAdmin: true, canManage: false }),
    ).rejects.toMatchObject({ code: "invalidState" })
  })
})

describe("revokeMember", () => {
  it("supprime l'appartenance + bump + invalidate", async () => {
    pm.healthcareMembership.findUnique.mockResolvedValue({ id: 1, isPrincipalAdmin: false })
    pm.healthcareMembership.delete.mockResolvedValue({})
    pm.user.update.mockResolvedValue({})
    await orgMembershipService.revokeMember(1, "DOCTOR", 5, 9)
    expect(pm.healthcareMembership.delete).toHaveBeenCalled()
    expect(invalidateAllUserSessions).toHaveBeenCalledWith(5)
  })

  it("dernier admin principal → lastPrincipalAdmin (pas de suppression)", async () => {
    pm.healthcareMembership.findUnique.mockResolvedValue({ id: 1, isPrincipalAdmin: true })
    pm.healthcareMembership.count.mockResolvedValue(0) // aucun autre principal
    await expect(orgMembershipService.revokeMember(1, "ADMIN", 5, 9))
      .rejects.toMatchObject({ code: "lastPrincipalAdmin" })
    expect(pm.healthcareMembership.delete).not.toHaveBeenCalled()
  })

  it("membre inexistant → notFound", async () => {
    pm.healthcareMembership.findUnique.mockResolvedValue(null)
    await expect(orgMembershipService.revokeMember(1, "ADMIN", 5, 9))
      .rejects.toMatchObject({ code: "notFound" })
  })
})
