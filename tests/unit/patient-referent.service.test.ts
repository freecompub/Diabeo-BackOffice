/**
 * Test suite: patientReferentService (US-2021 + US-2028)
 *
 * Behaviour tested:
 * - `getReferentsView` flags the primary referent vs other members and only
 *   exposes `userId` for the primary entry (data-minimization Low).
 * - `transferReferent` rejects a member not part of any of the patient's
 *   services (`MemberNotEligibleError`).
 * - C3 — transfer authorization rules:
 *    * ADMIN: always allowed
 *    * current primary referent's user: allowed
 *    * target member's user: allowed (self-claim)
 *    * any other DOCTOR: `ReferentTransferForbiddenError`
 * - Audit metadata records the authorization path (admin / currentReferent / selfClaim).
 * - Patient `deletedAt: null` guard at the service layer (H7).
 */
import { describe, it, expect, beforeEach } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"
import { patientReferentService } from "@/lib/services/patient-referent.service"
import {
  MemberNotEligibleError,
  ReferentTransferForbiddenError,
} from "@/lib/services/patient-tag.errors"

beforeEach(() => {
  prismaMock.auditLog.create.mockResolvedValue({} as any)
  prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock))
})

describe("getReferentsView", () => {
  it("marks the primary referent and exposes userId ONLY for primary", async () => {
    prismaMock.patientService.findMany.mockResolvedValue([
      {
        service: {
          id: 10, name: "Cabinet A",
          members: [
            { id: 100, userId: 1 },
            { id: 101, userId: 2 },
          ],
        },
      },
    ] as any)
    prismaMock.patientReferent.findFirst.mockResolvedValue({ proId: 101 } as any)

    const entries = await patientReferentService.getReferentsView(42, 9)
    expect(entries).toHaveLength(2)
    const primary = entries.find((e) => e.role === "primary")!
    expect(primary.memberId).toBe(101)
    expect(primary.userId).toBe(2)
    const other = entries.find((e) => e.role === "service-member")!
    expect(other.userId).toBeNull()
  })
})

describe("transferReferent — eligibility (M3)", () => {
  it("rejects when patient is soft-deleted", async () => {
    prismaMock.patient.findFirst.mockResolvedValue(null)
    await expect(
      patientReferentService.transferReferent(42, 500, 7, false),
    ).rejects.toBeInstanceOf(MemberNotEligibleError)
  })

  it("rejects a member not linked to any service of the patient", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 42 } as any)
    prismaMock.healthcareMember.findFirst.mockResolvedValue(null)
    await expect(
      patientReferentService.transferReferent(42, 999, 7, false),
    ).rejects.toBeInstanceOf(MemberNotEligibleError)
  })
})

describe("transferReferent — authorization (C3)", () => {
  beforeEach(() => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 42 } as any)
    prismaMock.healthcareMember.findFirst.mockResolvedValue({
      id: 500, userId: 999, serviceId: 10,
    } as any)
    prismaMock.patientReferent.findUnique.mockResolvedValue({
      proId: 100, serviceId: 10, pro: { userId: 50 },
    } as any)
    prismaMock.patientReferent.upsert.mockResolvedValue({
      id: 1, patientId: 42, proId: 500, serviceId: 10,
    } as any)
  })

  it("rejects a DOCTOR who is neither current referent nor target", async () => {
    await expect(
      patientReferentService.transferReferent(42, 500, 77 /* random doctor */, false),
    ).rejects.toBeInstanceOf(ReferentTransferForbiddenError)
  })

  it("allows ADMIN regardless", async () => {
    const out = await patientReferentService.transferReferent(42, 500, 77, true /* isAdmin */)
    expect(out.proId).toBe(500)
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.metadata.authorizedBy).toBe("admin")
  })

  it("allows the current referent (current pro's user)", async () => {
    const out = await patientReferentService.transferReferent(42, 500, 50 /* current pro userId */, false)
    expect(out.proId).toBe(500)
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.metadata.authorizedBy).toBe("currentReferent")
  })

  it("allows the target pro themselves (self-claim)", async () => {
    const out = await patientReferentService.transferReferent(42, 500, 999 /* target pro userId */, false)
    expect(out.proId).toBe(500)
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.metadata.authorizedBy).toBe("selfClaim")
  })
})
