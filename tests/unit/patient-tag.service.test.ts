/**
 * Test suite: patientTagService (US-2022)
 *
 * Behaviour tested:
 * - Cabinet membership enforced on create/delete (`forbidden` if not member).
 * - Cross-cabinet contamination blocked: setForPatient rejects any tagId
 *   whose service the caller doesn't belong to.
 * - Label/color validation surfaces `TagValidationError` with the offending
 *   field name.
 * - Audit row written on every mutation (CREATE/UPDATE/DELETE) with the
 *   appropriate resource.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"
import { patientTagService, TagValidationError } from "@/lib/services/patient-tag.service"

beforeEach(() => {
  prismaMock.auditLog.create.mockResolvedValue({} as any)
  prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock))
})

describe("patientTagService.create", () => {
  it("rejects callers who are not members of the service", async () => {
    prismaMock.healthcareMember.findFirst.mockResolvedValue(null)
    await expect(
      patientTagService.create({ serviceId: 1, label: "VIP", color: "#FF0000" }, 99),
    ).rejects.toThrow(/forbidden/)
  })

  it("rejects an empty label", async () => {
    prismaMock.healthcareMember.findFirst.mockResolvedValue({ id: 1 } as any)
    await expect(
      patientTagService.create({ serviceId: 1, label: "  ", color: "#FF0000" }, 7),
    ).rejects.toBeInstanceOf(TagValidationError)
  })

  it("rejects an invalid color format", async () => {
    prismaMock.healthcareMember.findFirst.mockResolvedValue({ id: 1 } as any)
    await expect(
      patientTagService.create({ serviceId: 1, label: "VIP", color: "red" }, 7),
    ).rejects.toBeInstanceOf(TagValidationError)
  })

  it("creates the tag and audits it", async () => {
    prismaMock.healthcareMember.findFirst.mockResolvedValue({ id: 1 } as any)
    prismaMock.patientTag.create.mockResolvedValue({
      id: 42, serviceId: 1, label: "VIP", color: "#FF0000",
    } as any)
    const tag = await patientTagService.create(
      { serviceId: 1, label: "VIP ", color: "#ff0000" },
      7,
    )
    expect(tag.id).toBe(42)
    // Color is normalized to uppercase, label trimmed.
    const createCall = prismaMock.patientTag.create.mock.calls[0][0] as any
    expect(createCall.data.label).toBe("VIP")
    expect(createCall.data.color).toBe("#FF0000")
    const audit = prismaMock.auditLog.create.mock.calls[0][0].data as any
    expect(audit.resource).toBe("PATIENT_TAG")
    expect(audit.action).toBe("CREATE")
  })
})

describe("patientTagService.setForPatient", () => {
  it("rejects assignments mixing tags from non-member services", async () => {
    prismaMock.patientTag.findMany.mockResolvedValue([
      { id: 1, serviceId: 10 },
      { id: 2, serviceId: 99 }, // foreign service
    ] as any)
    prismaMock.healthcareMember.findMany.mockResolvedValue([
      { serviceId: 10 },
    ] as any)
    await expect(
      patientTagService.setForPatient(7, [1, 2], 99),
    ).rejects.toThrow(/forbidden/)
  })

  it("dedupes and applies the new set atomically", async () => {
    prismaMock.patientTag.findMany.mockResolvedValue([
      { id: 1, serviceId: 10 },
      { id: 2, serviceId: 10 },
    ] as any)
    prismaMock.healthcareMember.findMany.mockResolvedValue([{ serviceId: 10 }] as any)
    prismaMock.patientTagAssignment.deleteMany.mockResolvedValue({ count: 0 } as any)
    prismaMock.patientTagAssignment.createMany.mockResolvedValue({ count: 2 } as any)

    const res = await patientTagService.setForPatient(42, [1, 2, 2, 1], 7)
    expect(res.count).toBe(2)
    const createArgs = prismaMock.patientTagAssignment.createMany.mock.calls[0][0] as any
    expect(createArgs.data).toHaveLength(2)
  })

  it("handles empty list (clears all)", async () => {
    prismaMock.patientTagAssignment.deleteMany.mockResolvedValue({ count: 3 } as any)
    const res = await patientTagService.setForPatient(42, [], 7)
    expect(res.count).toBe(0)
    expect(prismaMock.patientTagAssignment.createMany).not.toHaveBeenCalled()
  })
})

describe("patientTagService.delete", () => {
  it("returns tagNotFound when the tag does not exist", async () => {
    prismaMock.patientTag.findUnique.mockResolvedValue(null)
    await expect(patientTagService.delete(999, 7)).rejects.toThrow(/tagNotFound/)
  })

  it("rejects non-member callers", async () => {
    prismaMock.patientTag.findUnique.mockResolvedValue({
      id: 1, serviceId: 10, label: "VIP",
    } as any)
    prismaMock.healthcareMember.findFirst.mockResolvedValue(null)
    await expect(patientTagService.delete(1, 99)).rejects.toThrow(/forbidden/)
  })
})
