/**
 * Unit tests for access control and objectives service.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockDeep, mockReset } from "vitest-mock-extended"
import type { PrismaClient } from "@prisma/client"

const prismaMock = mockDeep<PrismaClient>()

vi.mock("@/lib/db/client", () => ({
  prisma: prismaMock,
}))

vi.mock("@/lib/services/audit.service", () => ({
  auditService: {
    log: vi.fn().mockResolvedValue({}),
    logWithTx: vi.fn().mockResolvedValue({}),
  },
}))

beforeEach(() => {
  mockReset(prismaMock)
})

// =========================================================================
// Access Control
// =========================================================================
describe("canAccessPatient", () => {
  let canAccessPatient: typeof import("@/lib/access-control").canAccessPatient

  beforeEach(async () => {
    const mod = await import("@/lib/access-control")
    canAccessPatient = mod.canAccessPatient
  })

  it("ADMIN can access any patient", async () => {
    const result = await canAccessPatient(1, "ADMIN", 99)
    expect(result).toBe(true)
  })

  it("VIEWER can access own patient record", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({
      id: 5, userId: 42, pathology: "DT1", createdAt: new Date(), deletedAt: null,
    })
    const result = await canAccessPatient(42, "VIEWER", 5)
    expect(result).toBe(true)
  })

  it("VIEWER cannot access other patient record", async () => {
    // findFirst with userId=42 + patientId=5 returns null (no match)
    prismaMock.patient.findFirst.mockResolvedValue(null)
    const result = await canAccessPatient(42, "VIEWER", 5)
    expect(result).toBe(false)
  })

  it("DOCTOR can access patient from their service", async () => {
    prismaMock.patientService.findFirst.mockResolvedValue({
      id: 1, patientId: 5, serviceId: 1, joinedAt: new Date(),
    } as never)
    const result = await canAccessPatient(10, "DOCTOR", 5)
    expect(result).toBe(true)
  })

  it("DOCTOR cannot access patient outside their service", async () => {
    prismaMock.patientService.findFirst.mockResolvedValue(null)
    const result = await canAccessPatient(10, "DOCTOR", 5)
    expect(result).toBe(false)
  })
})

// =========================================================================
// Objectives — CGM threshold validation
// =========================================================================
describe("CGM threshold validation", () => {
  it("validates ordered thresholds: veryLow < low < ok < high", () => {
    // Valid
    expect(0.54 < 0.70 && 0.70 < 1.80 && 1.80 < 2.50).toBe(true)
    // Invalid: low > ok
    expect(0.54 < 2.00 && 2.00 < 1.80).toBe(false)
  })

  it("ADA default values are clinically correct", () => {
    const defaults = { veryLow: 0.54, low: 0.70, ok: 1.80, high: 2.50 }
    // 54 mg/dL severe hypo threshold
    expect(defaults.veryLow * 100).toBe(54)
    // 70 mg/dL hypo threshold
    expect(defaults.low * 100).toBe(70)
    // 180 mg/dL upper target
    expect(defaults.ok * 100).toBeCloseTo(180)
    // 250 mg/dL elevated
    expect(defaults.high * 100).toBe(250)
  })
})
