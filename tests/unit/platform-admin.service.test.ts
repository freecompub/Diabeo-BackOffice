/**
 * Test suite : platform-admin.service (US-2613 — bootstrap + personnel cross-tenant).
 *
 * Couvre : vue personnel (PII admin déchiffrée + appartenances, sans PHI), et le
 * bootstrap du PREMIER org-admin (refus si un admin principal existe déjà ;
 * délégation à org-membership.inviteMember ; audit ORG_ADMIN_BOOTSTRAPPED).
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

vi.mock("@/lib/crypto/fields", () => ({
  safeDecryptField: (v: string | null) => (v ? v.replace(/^enc:/, "dec:") : v),
}))
vi.mock("@/lib/services/org-membership.service", () => ({
  orgMembershipService: { inviteMember: vi.fn() },
  OrgMembershipError: class extends Error {},
  orgMembershipErrorStatus: () => 409,
}))

import { platformAdminService, PlatformAdminError } from "@/lib/services/platform-admin.service"
import { orgMembershipService } from "@/lib/services/org-membership.service"

const mInvite = vi.mocked(orgMembershipService.inviteMember)
const pm = prismaMock as unknown as {
  user: { findUnique: any }
  healthcareService: { findUnique: any }
  healthcareMembership: { findMany: any; findFirst: any }
  auditLog: { create: any }
}

beforeEach(() => {
  vi.clearAllMocks()
  pm.auditLog.create.mockResolvedValue({})
})

describe("getUserCapabilities", () => {
  it("user inexistant → notFound", async () => {
    pm.user.findUnique.mockResolvedValue(null)
    await expect(platformAdminService.getUserCapabilities(9, 1)).rejects.toBeInstanceOf(PlatformAdminError)
  })

  it("mappe identité (PII déchiffrée) + appartenances cross-tenant", async () => {
    pm.user.findUnique.mockResolvedValue({
      id: 5, firstname: "enc:Sophie", lastname: "enc:Martin", email: "enc:s@x.fr",
      role: "DOCTOR", status: "active",
    })
    pm.healthcareMembership.findMany.mockResolvedValue([
      { serviceId: 9, clinicalRole: "DOCTOR", canManage: true, isPrincipalAdmin: true, service: { name: "Nord", tenantId: 3 } },
    ])
    const r = await platformAdminService.getUserCapabilities(5, 1)
    expect(r.user).toMatchObject({ firstname: "dec:Sophie", email: "dec:s@x.fr", role: "DOCTOR" })
    expect(r.memberships[0]).toMatchObject({ serviceId: 9, serviceName: "Nord", tenantId: 3, isPrincipalAdmin: true })
  })
})

describe("bootstrapOrgAdmin", () => {
  it("établissement inexistant → notFound", async () => {
    pm.healthcareService.findUnique.mockResolvedValue(null)
    await expect(
      platformAdminService.bootstrapOrgAdmin(9, { email: "a@x.fr", clinicalRole: "DOCTOR" }, 1),
    ).rejects.toMatchObject({ code: "notFound" })
  })

  it("admin principal déjà présent → alreadyBootstrapped", async () => {
    pm.healthcareService.findUnique.mockResolvedValue({ id: 9 })
    pm.healthcareMembership.findFirst.mockResolvedValue({ id: 1 })
    await expect(
      platformAdminService.bootstrapOrgAdmin(9, { email: "a@x.fr", clinicalRole: "DOCTOR" }, 1),
    ).rejects.toMatchObject({ code: "alreadyBootstrapped" })
    expect(mInvite).not.toHaveBeenCalled()
  })

  it("succès → inviteMember (isPrincipalAdmin) + audit ORG_ADMIN_BOOTSTRAPPED", async () => {
    pm.healthcareService.findUnique.mockResolvedValue({ id: 9 })
    pm.healthcareMembership.findFirst.mockResolvedValue(null)
    mInvite.mockResolvedValue({ userId: 50, invitedNewUser: true })
    const r = await platformAdminService.bootstrapOrgAdmin(
      9, { email: "a@x.fr", clinicalRole: "DOCTOR", firstName: "A", lastName: "B" }, 1,
    )
    expect(r).toEqual({ userId: 50, invitedNewUser: true })
    // inviteMember appelé en ADMIN, scope serviceId, isPrincipalAdmin true.
    expect(mInvite).toHaveBeenCalledWith(
      1, "ADMIN", 9,
      expect.objectContaining({ email: "a@x.fr", clinicalRole: "DOCTOR", isPrincipalAdmin: true }),
      undefined,
    )
    expect(pm.auditLog.create.mock.calls[0][0].data.action).toBe("ORG_ADMIN_BOOTSTRAPPED")
  })
})
