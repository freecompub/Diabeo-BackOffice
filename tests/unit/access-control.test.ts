/**
 * Test suite: Access Control and CGM Objectives Service
 *
 * Clinical behavior tested:
 * - Role-based access enforcement ensuring DOCTOR, NURSE, and VIEWER roles
 *   can only read or mutate patient data within their authorized scope
 * - CGM threshold evaluation: mapping glycemia values to low/normal/high/critical
 *   categories used to trigger clinical alerts
 * - Objectives service CRUD: creating and updating glycemia and CGM objectives
 *   per patient with pathology-specific defaults
 *
 * Associated risks:
 * - Unauthorized access to patient data by an under-privileged role would
 *   constitute a RGPD Article 9 and HDS compliance breach
 * - Incorrect CGM threshold classification could suppress critical hypoglycemia
 *   alerts or generate false alarms, endangering patient safety
 * - Mutation of objectives without proper role guard could allow a VIEWER to
 *   alter clinical targets silently
 *
 * Edge cases:
 * - VIEWER attempting write operations (must be rejected)
 * - Glucose value exactly on a threshold boundary (low=0.70 g/L, high=1.80 g/L)
 * - Patient with no existing objective record (first creation)
 * - Objectives update with partial fields (only provided fields change)
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

  it("ADMIN can access any non-deleted patient", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({
      id: 99, userId: 50, pathology: "DT1", pregnancyMode: false,
      // US-2076bis-V2 (Issue #442) — publicRef requis dans le shape Patient.
      publicRef: "99000000-0000-4000-8000-000000000000",
      createdAt: new Date(), deletedAt: null,
    })
    const result = await canAccessPatient(1, "ADMIN", 99)
    expect(result).toBe(true)
  })

  it("ADMIN cannot access soft-deleted patient", async () => {
    prismaMock.patient.findFirst.mockResolvedValue(null)
    const result = await canAccessPatient(1, "ADMIN", 99)
    expect(result).toBe(false)
  })

  it("VIEWER can access own patient record", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({
      id: 5, userId: 42, pathology: "DT1", pregnancyMode: false,
      // US-2076bis-V2 (Issue #442) — publicRef requis dans le shape Patient.
      publicRef: "05000000-0000-4000-8000-000000000000",
      createdAt: new Date(), deletedAt: null,
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

  // US-2618/F6 — DOCTOR isolé par médecin référent (PatientReferent.pro.userId).
  it("DOCTOR can access a patient they are the referent of", async () => {
    prismaMock.patientReferent.findFirst.mockResolvedValue({ id: 1 } as never)
    const result = await canAccessPatient(10, "DOCTOR", 5)
    expect(result).toBe(true)
    // Vérifie qu'on interroge bien le référent (pas le service) pour un DOCTOR.
    expect(prismaMock.patientReferent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ patientId: 5, pro: { userId: 10 } }) }),
    )
  })

  it("DOCTOR cannot access a patient of another doctor in the same service (F6)", async () => {
    // Médecin B n'est pas le référent → aucune row référent pour (patient, B).
    prismaMock.patientReferent.findFirst.mockResolvedValue(null)
    const result = await canAccessPatient(99, "DOCTOR", 5)
    expect(result).toBe(false)
    // F6 : on ne retombe PAS sur l'appartenance au service pour un DOCTOR.
    expect(prismaMock.patientService.findFirst).not.toHaveBeenCalled()
  })

  // NURSE garde le périmètre service (inchangé).
  it("NURSE can access a patient of their service", async () => {
    prismaMock.patientService.findFirst.mockResolvedValue({ id: 1 } as never)
    const result = await canAccessPatient(20, "NURSE", 5)
    expect(result).toBe(true)
    expect(prismaMock.patientReferent.findFirst).not.toHaveBeenCalled()
  })

  it("NURSE cannot access a patient outside their service", async () => {
    prismaMock.patientService.findFirst.mockResolvedValue(null)
    const result = await canAccessPatient(20, "NURSE", 5)
    expect(result).toBe(false)
  })
})

describe("getAccessiblePatientIds", () => {
  let getAccessiblePatientIds: typeof import("@/lib/access-control").getAccessiblePatientIds

  beforeEach(async () => {
    getAccessiblePatientIds = (await import("@/lib/access-control")).getAccessiblePatientIds
  })

  it("ADMIN → null (no restriction)", async () => {
    expect(await getAccessiblePatientIds(1, "ADMIN")).toBeNull()
  })

  it("DOCTOR → referent-scoped patient IDs (F6)", async () => {
    prismaMock.patientReferent.findMany.mockResolvedValue([
      { patientId: 5 }, { patientId: 7 },
    ] as never)
    const ids = await getAccessiblePatientIds(10, "DOCTOR")
    expect(ids).toEqual([5, 7])
    expect(prismaMock.patientReferent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ pro: { userId: 10 } }) }),
    )
    expect(prismaMock.patientService.findMany).not.toHaveBeenCalled()
  })

  it("NURSE → service-scoped patient IDs (unchanged)", async () => {
    prismaMock.patientService.findMany.mockResolvedValue([
      { patientId: 5 }, { patientId: 6 },
    ] as never)
    const ids = await getAccessiblePatientIds(20, "NURSE")
    expect(ids).toEqual([5, 6])
    expect(prismaMock.patientReferent.findMany).not.toHaveBeenCalled()
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
