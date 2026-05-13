/**
 * Test suite: insulin-meals services (Groupe 5 Batch 1, 5 US, 11 SP)
 *
 * Covers:
 *  - US-2043 pumpEventService.bulkSync : batch cap + eventType allowlist
 *  - US-2050 insulinAdjustmentTemplateService : RBAC + payload size + parameter
 *  - US-2053 mealValidationService : idempotent validate + audit
 *  - US-2054 foodItemService : HMAC search + getById
 *  - US-2057 mealPhotoService : MIME / size guards + event-patient mismatch
 *
 * S3 upload + ClamAV scan are mocked at the module boundary.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

// Mock S3 + ClamAV before importing the service.
vi.mock("@/lib/storage/s3", () => ({
  generateObjectKey: vi.fn(() => "meal-photos/7/abc.jpg"),
  uploadFile: vi.fn(async () => ({ key: "meal-photos/7/abc.jpg", size: 123 })),
  deleteFile: vi.fn(async () => {}),
}))
// C1 — ScanResult shape is { scanned, clean, viruses } (no `infected` field).
vi.mock("@/lib/services/antivirus.service", () => ({
  scanBuffer: vi.fn(async () => ({ scanned: true, clean: true, viruses: [] })),
}))
// Mock sharp so tests don't need real image data.
vi.mock("sharp", () => {
  const sharpFn: any = vi.fn(() => sharpFn)
  sharpFn.rotate = vi.fn(() => sharpFn)
  sharpFn.jpeg = vi.fn(() => sharpFn)
  sharpFn.png = vi.fn(() => sharpFn)
  sharpFn.webp = vi.fn(() => sharpFn)
  sharpFn.withMetadata = vi.fn(() => sharpFn)
  sharpFn.toBuffer = vi.fn(async () => ({
    data: Buffer.from([0xff, 0xd8, 0xff]),
    info: { width: 800, height: 600 },
  }))
  return { default: sharpFn }
})

import {
  pumpEventService,
  insulinAdjustmentTemplateService,
  mealValidationService,
  foodItemService,
  mealPhotoService,
} from "@/lib/services/insulin-meals.service"
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/services/team-workflow.errors"
import { scanBuffer } from "@/lib/services/antivirus.service"

beforeEach(() => {
  prismaMock.auditLog.create.mockResolvedValue({} as any)
  prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock))
})

describe("pumpEventService.bulkSync (US-2043)", () => {
  it("returns 0 on empty batch without DB call", async () => {
    const out = await pumpEventService.bulkSync(7, [], 9)
    expect(out.inserted).toBe(0)
    expect(prismaMock.pumpEvent.createMany).not.toHaveBeenCalled()
  })

  it("rejects batch > 1000", async () => {
    const events = Array.from({ length: 1001 }, () => ({
      timestamp: new Date(), eventType: "alarm",
    }))
    await expect(pumpEventService.bulkSync(7, events, 9))
      .rejects.toBeInstanceOf(ValidationError)
  })

  it("rejects unknown eventType", async () => {
    await expect(
      pumpEventService.bulkSync(7, [{ timestamp: new Date(), eventType: "FOO" }], 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it("rejects when patient is missing", async () => {
    prismaMock.patient.findFirst.mockResolvedValue(null)
    await expect(
      pumpEventService.bulkSync(7, [{ timestamp: new Date(), eventType: "alarm" }], 9),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it("inserts allowlisted events and audits IMPORT", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 7 } as any)
    prismaMock.pumpEvent.createMany.mockResolvedValue({ count: 2 } as any)
    const out = await pumpEventService.bulkSync(
      7,
      [
        { timestamp: new Date(), eventType: "alarm" },
        { timestamp: new Date(), eventType: "bolus" },
      ],
      9,
    )
    expect(out.inserted).toBe(2)
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.action).toBe("IMPORT")
    expect(audit.metadata.patientId).toBe(7)
  })
})

describe("insulinAdjustmentTemplateService (US-2050)", () => {
  it("rejects empty title", async () => {
    prismaMock.healthcareMember.findFirst.mockResolvedValue({ id: 1 } as any)
    await expect(
      insulinAdjustmentTemplateService.create(
        { serviceId: 1, title: "  ", parameter: "BASAL", adjustments: { x: 1 } }, 9,
      ),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it("rejects invalid parameter", async () => {
    prismaMock.healthcareMember.findFirst.mockResolvedValue({ id: 1 } as any)
    await expect(
      insulinAdjustmentTemplateService.create(
        { serviceId: 1, title: "T", parameter: "BAD" as any, adjustments: { x: 1 } }, 9,
      ),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it("rejects oversized adjustments payload", async () => {
    prismaMock.healthcareMember.findFirst.mockResolvedValue({ id: 1 } as any)
    await expect(
      insulinAdjustmentTemplateService.create(
        {
          serviceId: 1, title: "T", parameter: "BASAL",
          adjustments: { huge: "x".repeat(5000) },
        }, 9,
      ),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it("rejects non-members on listForService", async () => {
    prismaMock.healthcareMember.findFirst.mockResolvedValue(null)
    await expect(insulinAdjustmentTemplateService.listForService(1, 99))
      .rejects.toBeInstanceOf(ForbiddenError)
  })

  it("happy path create returns DTO", async () => {
    prismaMock.healthcareMember.findFirst.mockResolvedValue({ id: 1 } as any)
    prismaMock.insulinAdjustmentTemplate.create.mockResolvedValue({
      id: 1, serviceId: 1, title: "T",
      pathology: null, parameter: "BASAL", adjustments: { x: 1 },
    } as any)
    const out = await insulinAdjustmentTemplateService.create(
      { serviceId: 1, title: "T", parameter: "BASAL", adjustments: { x: 1 } }, 9,
    )
    expect(out.parameter).toBe("BASAL")
  })

  it("delete returns NotFound when missing", async () => {
    prismaMock.insulinAdjustmentTemplate.findUnique.mockResolvedValue(null)
    await expect(insulinAdjustmentTemplateService.delete(999, 9))
      .rejects.toBeInstanceOf(NotFoundError)
  })
})

describe("mealValidationService (US-2053)", () => {
  it("validate idempotent on already-validated event", async () => {
    const validatedAt = new Date()
    prismaMock.diabetesEvent.findUnique.mockResolvedValue({
      id: "uuid", patientId: 7, validatedAt, validatedBy: 5,
    } as any)
    prismaMock.patient.findFirst.mockResolvedValue({ id: 7 } as any)
    const out = await mealValidationService.validate("uuid", 9)
    expect(out.validatedAt).toBe(validatedAt)
    expect(prismaMock.diabetesEvent.update).not.toHaveBeenCalled()
  })

  it("validate updates + audits when not yet validated", async () => {
    prismaMock.diabetesEvent.findUnique.mockResolvedValue({
      id: "uuid", patientId: 7, validatedAt: null, validatedBy: null,
    } as any)
    prismaMock.patient.findFirst.mockResolvedValue({ id: 7 } as any)
    prismaMock.diabetesEvent.update.mockResolvedValue({
      validatedAt: new Date(), validatedBy: 9,
    } as any)
    await mealValidationService.validate("uuid", 9)
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.action).toBe("UPDATE")
    expect(audit.metadata.patientId).toBe(7)
  })

  it("validate returns NotFound for missing event", async () => {
    prismaMock.diabetesEvent.findUnique.mockResolvedValue(null)
    await expect(mealValidationService.validate("uuid", 9))
      .rejects.toBeInstanceOf(NotFoundError)
  })

  it("listPendingForPatient audits READ", async () => {
    prismaMock.diabetesEvent.findMany.mockResolvedValue([] as any)
    await mealValidationService.listPendingForPatient(7, 9)
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.metadata.kind).toBe("pending-validation")
  })
})

describe("foodItemService (US-2054)", () => {
  it("search by name uses HMAC equality (no audit emitted — M2)", async () => {
    prismaMock.foodItem.findMany.mockResolvedValue([] as any)
    const beforeAudits = prismaMock.auditLog.create.mock.calls.length
    await foodItemService.search({ name: "Riz blanc" })
    const call = prismaMock.foodItem.findMany.mock.calls[0][0] as any
    expect(call.where.nameHmac).toBeTypeOf("string")
    expect(call.where.nameHmac).toHaveLength(64) // SHA256 hex
    // M2 — public CIQUAL data, no audit.
    expect(prismaMock.auditLog.create.mock.calls.length).toBe(beforeAudits)
  })

  it("getById returns null when missing", async () => {
    prismaMock.foodItem.findUnique.mockResolvedValue(null)
    const r = await foodItemService.getById(999)
    expect(r).toBeNull()
  })

  it("getById returns DTO with decimalToNumber coercion (M1)", async () => {
    prismaMock.foodItem.findUnique.mockResolvedValue({
      id: 1, ciqualCode: "20051", name: "Riz",
      carbsPer100g: "80.5", proteinPer100g: null,
      fatPer100g: null, energyKcal100g: null, category: "Cereales",
    } as any)
    const r = await foodItemService.getById(1)
    expect(r?.carbsPer100g).toBe(80.5)
    expect(r?.proteinPer100g).toBeNull()
  })

  it("search NFC-normalizes the name before HMAC (L1)", async () => {
    prismaMock.foodItem.findMany.mockResolvedValue([] as any)
    // Two encodings of "café" — NFC vs NFD — should produce the same HMAC.
    await foodItemService.search({ name: "café" })
    const hmacNfc = (prismaMock.foodItem.findMany.mock.calls[0][0] as any).where.nameHmac
    prismaMock.foodItem.findMany.mockClear()
    await foodItemService.search({ name: "café" }) // NFD
    const hmacNfd = (prismaMock.foodItem.findMany.mock.calls[0][0] as any).where.nameHmac
    expect(hmacNfc).toBe(hmacNfd)
  })
})

describe("mealPhotoService (US-2057, post review)", () => {
  // Valid JPEG magic bytes for the magic-byte sniffer (M4).
  const jpegBuffer = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]),
    Buffer.alloc(100),
  ])

  it("rejects unsupported MIME", async () => {
    await expect(
      mealPhotoService.upload({
        eventId: "uuid", patientId: 7, buffer: Buffer.from([1]),
        mimeType: "application/x-msdos-program",
      }, 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it("rejects oversized buffer", async () => {
    const tooBig = Buffer.alloc(6 * 1024 * 1024)
    await expect(
      mealPhotoService.upload({
        eventId: "uuid", patientId: 7, buffer: tooBig, mimeType: "image/jpeg",
      }, 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it("rejects mimeMismatch when declared JPEG but bytes are not (M4)", async () => {
    const fakeJpeg = Buffer.from([0x42, 0x42, 0x42, 0x42, 0x42, 0x42, 0x42, 0x42, 0x42, 0x42, 0x42, 0x42])
    await expect(
      mealPhotoService.upload({
        eventId: "uuid", patientId: 7, buffer: fakeJpeg, mimeType: "image/jpeg",
      }, 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it("rejects mismatched event/patient inside the transaction (C3)", async () => {
    prismaMock.diabetesEvent.findFirst.mockResolvedValue(null)
    await expect(
      mealPhotoService.upload({
        eventId: "uuid", patientId: 7, buffer: jpegBuffer, mimeType: "image/jpeg",
      }, 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it("rejects infected upload (ClamAV)", async () => {
    vi.mocked(scanBuffer).mockResolvedValueOnce({ scanned: true, clean: false, viruses: ["Eicar"] })
    await expect(
      mealPhotoService.upload({
        eventId: "uuid", patientId: 7, buffer: jpegBuffer, mimeType: "image/jpeg",
      }, 9),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("happy path uploads, strips metadata + audits with patientId pivot", async () => {
    vi.mocked(scanBuffer).mockResolvedValueOnce({ scanned: true, clean: true, viruses: [] })
    prismaMock.diabetesEvent.findFirst.mockResolvedValue({ id: "uuid" } as any)
    prismaMock.mealPhoto.create.mockResolvedValue({
      id: 1, eventId: "uuid", patientId: 7,
      mimeType: "image/jpeg", sizeBytes: 3, width: 800, height: 600, createdAt: new Date(),
    } as any)
    const out = await mealPhotoService.upload({
      eventId: "uuid", patientId: 7,
      buffer: jpegBuffer, mimeType: "image/jpeg",
    }, 9)
    expect(out.id).toBe(1)
    // M13 — DTO does NOT include s3Key
    expect((out as Record<string, unknown>).s3Key).toBeUndefined()
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.action).toBe("CREATE")
    expect(audit.metadata.patientId).toBe(7)
    expect(audit.metadata.stripped).toBe(true)
  })
})
