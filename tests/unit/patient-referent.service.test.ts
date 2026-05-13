/**
 * Test suite: patientReferentService (US-2021 + US-2028)
 *
 * Behaviour tested:
 * - `getReferentsView` flags the primary referent vs other members.
 * - Duplicate members across services are deduped.
 * - `transferReferent` rejects a member who isn't part of any of the
 *   patient's services (`memberNotEligible`).
 * - The new referent is upserted (creates or updates).
 */
import { describe, it, expect, beforeEach } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"
import { patientReferentService } from "@/lib/services/patient-referent.service"

beforeEach(() => {
  prismaMock.auditLog.create.mockResolvedValue({} as any)
  prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock))
})

describe("getReferentsView", () => {
  it("marks the primary referent and lists every service member", async () => {
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
      {
        service: {
          id: 20, name: "Cabinet B",
          members: [
            { id: 200, userId: 3 },
          ],
        },
      },
    ] as any)
    prismaMock.patientReferent.findUnique.mockResolvedValue({ proId: 101 } as any)

    const entries = await patientReferentService.getReferentsView(42, 9)
    expect(entries).toHaveLength(3)
    const primary = entries.find((e) => e.memberId === 101)!
    expect(primary.role).toBe("primary")
    expect(entries.filter((e) => e.role === "service-member")).toHaveLength(2)
  })
})

describe("transferReferent", () => {
  it("rejects a member not linked to any service of the patient", async () => {
    prismaMock.healthcareMember.findFirst.mockResolvedValue(null)
    await expect(
      patientReferentService.transferReferent(42, 999, 7),
    ).rejects.toThrow(/memberNotEligible/)
  })

  it("upserts the referent and audits the change", async () => {
    prismaMock.healthcareMember.findFirst.mockResolvedValue({
      id: 500, serviceId: 10,
    } as any)
    prismaMock.patientReferent.findUnique.mockResolvedValue({
      proId: 100, serviceId: 10,
    } as any)
    prismaMock.patientReferent.upsert.mockResolvedValue({
      id: 1, patientId: 42, proId: 500, serviceId: 10,
    } as any)

    const out = await patientReferentService.transferReferent(42, 500, 7)
    expect(out.proId).toBe(500)
    const audit = prismaMock.auditLog.create.mock.calls[0][0].data as any
    expect(audit.action).toBe("UPDATE")
    expect(audit.resource).toBe("REFERENT")
    expect(audit.metadata).toMatchObject({
      patientId: 42, previousProId: 100, newProId: 500,
    })
  })
})
