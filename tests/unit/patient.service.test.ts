/**
 * Unit tests for patient.service.ts.
 *
 * Tests the patient CRUD operations including:
 * - Patient creation with encryption
 * - Patient retrieval with decryption
 * - Soft delete (RGPD compliance) with anonymization
 * - Audit logging for every operation
 */

import { describe, it, expect, vi } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

import { patientService } from "@/lib/services/patient.service"

// ---------------------------------------------------------------------------
// Transaction mock helper
// ---------------------------------------------------------------------------

/**
 * Sets up prismaMock.$transaction to execute the callback with a mock tx
 * that has the methods patient.service.ts uses.
 */
function mockTransaction(txOverrides: Record<string, any> = {}) {
  prismaMock.$transaction.mockImplementation(async (fn: any) => {
    const txMock = {
      user: {
        update: vi.fn().mockResolvedValue({}),
        ...txOverrides.user,
      },
      patient: {
        create: vi.fn().mockResolvedValue({
          id: 1,
          userId: 10,
          pathology: "DT1",
          deletedAt: null,
        }),
        findUnique: vi.fn().mockResolvedValue({
          id: 1,
          userId: 10,
          pathology: "DT1",
          deletedAt: null,
        }),
        update: vi.fn().mockResolvedValue({
          id: 1,
          userId: 10,
          pathology: "DT1",
          deletedAt: new Date("2025-06-15"),
        }),
        ...txOverrides.patient,
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({}),
        ...txOverrides.auditLog,
      },
    }
    return fn(txMock)
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("patientService.create", () => {
  it("creates a patient and encrypts personal data", async () => {
    mockTransaction()

    const result = await patientService.create(
      {
        pathology: "DT1" as any,
        personalData: {
          firstName: "Jean",
          lastName: "Dupont",
          birthDate: "1990-05-15",
        },
        userId: 10,
      },
      1, // auditUserId
    )

    expect(result).toEqual({ id: 1, pathology: "DT1" })
  })

  it("encrypts firstname and lastname on user update", async () => {
    let capturedUserUpdate: any = null

    prismaMock.$transaction.mockImplementation(async (fn: any) => {
      const txMock = {
        user: {
          update: vi.fn().mockImplementation((args: any) => {
            capturedUserUpdate = args
            return {}
          }),
        },
        patient: {
          create: vi.fn().mockResolvedValue({ id: 1, pathology: "DT1" }),
        },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      return fn(txMock)
    })

    await patientService.create(
      {
        pathology: "DT1" as any,
        personalData: {
          firstName: "Marie",
          lastName: "Martin",
          birthDate: "1985-03-20",
        },
        userId: 10,
      },
      1,
    )

    // The firstname and lastname should be base64 encoded encrypted strings
    expect(capturedUserUpdate.data.firstname).not.toBe("Marie")
    expect(capturedUserUpdate.data.lastname).not.toBe("Martin")
    // They should be valid base64
    expect(capturedUserUpdate.data.firstname).toMatch(/^[A-Za-z0-9+/=]+$/)
    expect(capturedUserUpdate.data.lastname).toMatch(/^[A-Za-z0-9+/=]+$/)
  })

  it("logs audit entry for patient creation", async () => {
    let auditCalled = false

    prismaMock.$transaction.mockImplementation(async (fn: any) => {
      const txMock = {
        user: { update: vi.fn().mockResolvedValue({}) },
        patient: {
          create: vi.fn().mockResolvedValue({ id: 42, pathology: "DT2" }),
        },
        auditLog: {
          create: vi.fn().mockImplementation(() => {
            auditCalled = true
            return {}
          }),
        },
      }
      return fn(txMock)
    })

    await patientService.create(
      {
        pathology: "DT2" as any,
        personalData: {
          firstName: "Paul",
          lastName: "Lefevre",
          birthDate: "2000-01-01",
        },
        userId: 5,
      },
      1,
    )

    expect(auditCalled).toBe(true)
  })
})

describe("patientService.getById", () => {
  it("returns patient with decrypted user fields", async () => {
    // We need to create encrypted values that can be decrypted
    const { encrypt } = await import("@/lib/crypto/health-data")

    const encryptedFirst = Buffer.from(encrypt("Jean")).toString("base64")
    const encryptedLast = Buffer.from(encrypt("Dupont")).toString("base64")

    prismaMock.patient.findFirst.mockResolvedValue({
      id: 1,
      userId: 10,
      pathology: "DT1",
      deletedAt: null,
      user: {
        id: 10,
        firstname: encryptedFirst,
        lastname: encryptedLast,
        email: "jean@test.com",
        sex: "M",
        birthday: null,
      },
      medicalData: null,
      cgmObjectives: null,
      annexObjectives: null,
    } as any)
    prismaMock.auditLog.create.mockResolvedValue({} as any)

    const result = await patientService.getById(1, 1)

    expect(result).not.toBeNull()
    expect(result!.user.firstname).toBe("Jean")
    expect(result!.user.lastname).toBe("Dupont")
  })

  it("returns null for non-existent patient", async () => {
    prismaMock.patient.findFirst.mockResolvedValue(null)

    const result = await patientService.getById(999, 1)

    expect(result).toBeNull()
  })

  it("handles plaintext values gracefully (safeDecrypt fallback)", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({
      id: 1,
      userId: 10,
      pathology: "DT1",
      deletedAt: null,
      user: {
        id: 10,
        firstname: "PlainTextName",  // not encrypted
        lastname: "PlainTextLast",
        email: "test@test.com",
        sex: "M",
        birthday: null,
      },
      medicalData: null,
      cgmObjectives: null,
      annexObjectives: null,
    } as any)
    prismaMock.auditLog.create.mockResolvedValue({} as any)

    const result = await patientService.getById(1, 1)

    // safeDecrypt returns null on decryption failure — never leaks ciphertext
    expect(result!.user.firstname).toBeNull()
    expect(result!.user.lastname).toBeNull()
  })

  it("logs audit READ entry", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({
      id: 1,
      userId: 10,
      pathology: "DT1",
      deletedAt: null,
      user: { id: 10, firstname: null, lastname: null, email: null, sex: null, birthday: null },
      medicalData: null,
      cgmObjectives: null,
      annexObjectives: null,
    } as any)
    prismaMock.auditLog.create.mockResolvedValue({} as any)

    await patientService.getById(1, 5)

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 5,
        action: "READ",
        resource: "PATIENT",
        resourceId: "1",
      }),
    })
  })
})

describe("patientService.listByDoctor", () => {
  it("returns patients where doctor is referent", async () => {
    const { encrypt } = await import("@/lib/crypto/health-data")

    const encryptedFirst = Buffer.from(encrypt("Marie")).toString("base64")
    const encryptedLast = Buffer.from(encrypt("Martin")).toString("base64")

    const referents = [
      {
        id: 1,
        patientId: 10,
        proId: 5,
        patient: {
          id: 10,
          userId: 20,
          pathology: "DT1",
          deletedAt: null,
          user: {
            id: 20,
            firstname: encryptedFirst,
            lastname: encryptedLast,
            email: "test@test.com",
          },
        },
      },
    ]

    prismaMock.patientReferent.findMany.mockResolvedValue(referents as any)
    prismaMock.auditLog.create.mockResolvedValue({} as any)

    const result = await patientService.listByDoctor(5, 1)

    expect(prismaMock.patientReferent.findMany).toHaveBeenCalledWith({
      where: {
        pro: { userId: 5 },
        patient: { deletedAt: null },
      },
      include: {
        patient: {
          include: {
            user: { select: { id: true, firstname: true, lastname: true, email: true } },
          },
        },
      },
    })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(10)
    // Verify PII is decrypted
    expect(result[0].user.firstname).toBe("Marie")
    expect(result[0].user.lastname).toBe("Martin")
  })

  it("returns empty array when doctor has no patients", async () => {
    prismaMock.patientReferent.findMany.mockResolvedValue([])
    prismaMock.auditLog.create.mockResolvedValue({} as any)

    const result = await patientService.listByDoctor(99, 1)

    expect(result).toEqual([])
  })

  it("logs audit READ entry with doctor context", async () => {
    prismaMock.patientReferent.findMany.mockResolvedValue([])
    prismaMock.auditLog.create.mockResolvedValue({} as any)

    await patientService.listByDoctor(5, 2)

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 2,
        action: "READ",
        resource: "PATIENT",
        resourceId: "doctor:5",
        metadata: { action: "list", count: 0 },
      }),
    })
  })
})

describe("patientService.delete (soft delete)", () => {
  it("performs soft delete and anonymizes user data", async () => {
    let capturedUserUpdate: any = null

    prismaMock.$transaction.mockImplementation(async (fn: any) => {
      const txMock = {
        patient: {
          findUnique: vi.fn().mockResolvedValue({
            id: 1,
            userId: 10,
            deletedAt: null,
          }),
          update: vi.fn().mockResolvedValue({
            id: 1,
            userId: 10,
            deletedAt: new Date("2025-06-15"),
          }),
        },
        user: {
          update: vi.fn().mockImplementation((args: any) => {
            capturedUserUpdate = args
            return {}
          }),
        },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      return fn(txMock)
    })

    const result = await patientService.delete(1, 1)

    expect(result.deletedAt).toBeInstanceOf(Date)
    // Verify anonymization — fields are encrypted (base64 string), not plaintext
    expect(typeof capturedUserUpdate.data.firstname).toBe("string")
    expect(typeof capturedUserUpdate.data.lastname).toBe("string")
    expect(typeof capturedUserUpdate.data.email).toBe("string")
    expect(capturedUserUpdate.data.phone).toBeNull()
    expect(capturedUserUpdate.data.nirpp).toBeNull()
    expect(capturedUserUpdate.data.ins).toBeNull()
  })

  it("throws for already deleted patient", async () => {
    prismaMock.$transaction.mockImplementation(async (fn: any) => {
      const txMock = {
        patient: {
          findUnique: vi.fn().mockResolvedValue({
            id: 1,
            userId: 10,
            deletedAt: new Date("2025-01-01"), // already deleted
          }),
        },
        user: { update: vi.fn() },
        auditLog: { create: vi.fn() },
      }
      return fn(txMock)
    })

    await expect(patientService.delete(1, 1)).rejects.toThrow(
      "Patient not found or already deleted",
    )
  })

  it("throws for non-existent patient", async () => {
    prismaMock.$transaction.mockImplementation(async (fn: any) => {
      const txMock = {
        patient: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
        user: { update: vi.fn() },
        auditLog: { create: vi.fn() },
      }
      return fn(txMock)
    })

    await expect(patientService.delete(999, 1)).rejects.toThrow(
      "Patient not found or already deleted",
    )
  })
})
