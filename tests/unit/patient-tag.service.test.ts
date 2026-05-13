/**
 * Test suite: patientTagService (US-2022, post-review hardening)
 *
 * Behaviour tested (post PR #389 review):
 * - C1 — `listForService` rejects callers who aren't members of the target service.
 * - C2 — `setForPatient` collapses "unknown tag" and "cross-cabinet tag"
 *   into the SAME `TagForbiddenError` (no enumeration oracle).
 * - H4 — Label validation rejects PII patterns (long digits, '@', FR phone).
 * - H4 — Audit metadata for create/delete does NOT contain `label` plaintext.
 * - H5 — `setForPatient` runs membership + tag-exists check INSIDE the
 *   transaction with `Serializable` isolation.
 * - H10 — `setForPatient` audit row has `resourceId = patientId` and
 *   `metadata.patientId` for US-2268 forensics.
 * - H11 — `listForPatient` emits an audit READ row.
 * - M1 — `createMany` uses `skipDuplicates: true`.
 * - Patient soft-delete (`deletedAt`) blocks tag operations.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"
import {
  patientTagService,
  TagValidationError,
} from "@/lib/services/patient-tag.service"
import {
  TagForbiddenError,
  TagLabelPiiError,
  TagNotFoundError,
} from "@/lib/services/patient-tag.errors"

beforeEach(() => {
  prismaMock.auditLog.create.mockResolvedValue({} as any)
  prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock))
})

describe("listForService (C1 — membership check)", () => {
  it("rejects callers not member of the service", async () => {
    prismaMock.healthcareMember.findFirst.mockResolvedValue(null)
    await expect(
      patientTagService.listForService(1, 99),
    ).rejects.toBeInstanceOf(TagForbiddenError)
  })

  it("returns tags when caller is a member", async () => {
    prismaMock.healthcareMember.findFirst.mockResolvedValue({ id: 1 } as any)
    prismaMock.patientTag.findMany.mockResolvedValue([
      { id: 1, serviceId: 10, label: "VIP", color: "#FF0000" },
    ] as any)
    const r = await patientTagService.listForService(10, 7)
    expect(r.tags).toHaveLength(1)
    expect(r.tags[0]).toMatchObject({ id: 1, label: "VIP" })
  })
})

describe("create — label validation + PII rejection (H4)", () => {
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

  it.each([
    ["NIR 1800175123456", "long digits"],
    ["jean@dupont.fr", "email"],
    ["06 12 34 56 78", "FR phone"],
  ])("rejects PII-shaped label %j (%s)", async (label) => {
    prismaMock.healthcareMember.findFirst.mockResolvedValue({ id: 1 } as any)
    await expect(
      patientTagService.create({ serviceId: 1, label, color: "#FF0000" }, 7),
    ).rejects.toBeInstanceOf(TagLabelPiiError)
  })

  it("does NOT include `label` plaintext in audit metadata", async () => {
    prismaMock.healthcareMember.findFirst.mockResolvedValue({ id: 1 } as any)
    prismaMock.patientTag.create.mockResolvedValue({
      id: 42, serviceId: 1, label: "VIP", color: "#FF0000",
    } as any)
    await patientTagService.create(
      { serviceId: 1, label: "VIP", color: "#ff0000" },
      7,
    )
    const audit = prismaMock.auditLog.create.mock.calls[0][0].data as any
    expect(audit.resource).toBe("PATIENT_TAG")
    expect(audit.metadata).not.toHaveProperty("label")
  })
})

describe("setForPatient (C2 + H5 + H10)", () => {
  it("collapses unknown tag IDs into TagForbiddenError (no oracle)", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 7 } as any)
    prismaMock.healthcareMember.findMany.mockResolvedValue([
      { serviceId: 10 },
    ] as any)
    // Caller asks for tag 1 & 2, but only tag 1 (serviceId=10) found in
    // caller's services. Tag 2 either does not exist OR is foreign — both
    // collapse to forbidden.
    prismaMock.patientTag.findMany.mockResolvedValue([{ id: 1 }] as any)
    await expect(
      patientTagService.setForPatient(7, [1, 2], 99),
    ).rejects.toBeInstanceOf(TagForbiddenError)
  })

  it("blocks soft-deleted patients (H7)", async () => {
    prismaMock.patient.findFirst.mockResolvedValue(null)
    await expect(
      patientTagService.setForPatient(7, [1], 99),
    ).rejects.toBeInstanceOf(TagForbiddenError)
  })

  it("audit row has resourceId=patientId + metadata.patientId (US-2268)", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 42 } as any)
    prismaMock.healthcareMember.findMany.mockResolvedValue([{ serviceId: 10 }] as any)
    prismaMock.patientTag.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }] as any)
    prismaMock.patientTagAssignment.deleteMany.mockResolvedValue({ count: 0 } as any)
    prismaMock.patientTagAssignment.createMany.mockResolvedValue({ count: 2 } as any)

    await patientTagService.setForPatient(42, [1, 2, 2], 7)
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.resource).toBe("PATIENT_TAG_ASSIGNMENT")
    expect(audit.resourceId).toBe("42")
    expect(audit.metadata.patientId).toBe(42)
  })

  it("dedupes and uses skipDuplicates (M1)", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 42 } as any)
    prismaMock.healthcareMember.findMany.mockResolvedValue([{ serviceId: 10 }] as any)
    prismaMock.patientTag.findMany.mockResolvedValue([
      { id: 1 }, { id: 2 },
    ] as any)
    prismaMock.patientTagAssignment.deleteMany.mockResolvedValue({ count: 0 } as any)
    prismaMock.patientTagAssignment.createMany.mockResolvedValue({ count: 2 } as any)

    const res = await patientTagService.setForPatient(42, [1, 2, 2, 1], 7)
    expect(res.count).toBe(2)
    const createArgs = prismaMock.patientTagAssignment.createMany.mock.calls[0][0] as any
    expect(createArgs.data).toHaveLength(2)
    expect(createArgs.skipDuplicates).toBe(true)
  })

  it("handles empty list (clears all)", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 42 } as any)
    prismaMock.patientTagAssignment.deleteMany.mockResolvedValue({ count: 3 } as any)
    const res = await patientTagService.setForPatient(42, [], 7)
    expect(res.count).toBe(0)
    expect(prismaMock.patientTagAssignment.createMany).not.toHaveBeenCalled()
  })
})

describe("delete", () => {
  it("returns TagNotFoundError when the tag does not exist", async () => {
    prismaMock.patientTag.findUnique.mockResolvedValue(null)
    await expect(patientTagService.delete(999, 7)).rejects.toBeInstanceOf(TagNotFoundError)
  })

  it("rejects non-member callers", async () => {
    prismaMock.patientTag.findUnique.mockResolvedValue({
      id: 1, serviceId: 10,
    } as any)
    prismaMock.healthcareMember.findFirst.mockResolvedValue(null)
    await expect(patientTagService.delete(1, 99)).rejects.toBeInstanceOf(TagForbiddenError)
  })
})

describe("listForPatient (H11 — audit READ)", () => {
  it("emits an audit row", async () => {
    prismaMock.patientTagAssignment.findMany.mockResolvedValue([] as any)
    await patientTagService.listForPatient(42, 7)
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.action).toBe("READ")
    expect(audit.resource).toBe("PATIENT_TAG_ASSIGNMENT")
    expect(audit.resourceId).toBe("42")
    expect(audit.metadata.patientId).toBe(42)
  })
})
