/**
 * Test suite: patient-modes.service (Groupe 10 Batch C — 3 US, 16 SP)
 *
 * Couvre :
 *  - US-2233 pédiatrique : encrypt PHI, redacted snapshot, version increment,
 *    supersede prev, decrypt failure audit
 *  - US-2234 Ramadan : validation dates (29-30 jours), bornes ISF/ICR
 *    multipliers, sahur/iftar format HH:MM, year range
 *  - US-2235 voyage : tz offset bounds, basal multiplier bounds,
 *    departureDate < returnDate, trip < 365j
 *  - patientModeWorkflow : validate DOCTOR-only path, deactivate idempotent,
 *    listHistory restricts to supported mode types
 *  - computeBasalProtocol : 0/±3h/±6h/±12h → expected (multiplier, delay)
 */
import { describe, it, expect, beforeEach } from "vitest"
import { ConfigVersionStatus, ConfigVersionType } from "@prisma/client"
import { prismaMock } from "../helpers/prisma-mock"
import {
  pediatricModeService,
  ramadanModeService,
  travelModeService,
  patientModeWorkflow,
  computeBasalProtocol,
} from "@/lib/services/patient-modes.service"
import {
  NotFoundError,
  ValidationError,
} from "@/lib/services/team-workflow.errors"

beforeEach(() => {
  prismaMock.auditLog.create.mockResolvedValue({} as any)
  prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock))
})

// ─────────────────────────────────────────────────────────────
// US-2233 — Pediatric mode
// ─────────────────────────────────────────────────────────────

describe("pediatricModeService (US-2233)", () => {
  const validCaregivers = [
    { rank: 1, name: "Marie", phone: "0600000001", relationship: "mother", permissionLevel: "config" as const },
    { rank: 2, name: "Paul", phone: "0600000002", relationship: "father", permissionLevel: "write" as const },
  ]

  it("upsert rejects empty caregiver list", async () => {
    await expect(pediatricModeService.upsert(7, [], 9)).rejects.toBeInstanceOf(ValidationError)
  })

  it("upsert rejects > 5 caregivers", async () => {
    const six = Array.from({ length: 6 }, (_, i) => ({
      ...validCaregivers[0]!, rank: i + 1,
    }))
    await expect(pediatricModeService.upsert(7, six, 9)).rejects.toBeInstanceOf(ValidationError)
  })

  it("upsert rejects duplicate ranks", async () => {
    const dup = [validCaregivers[0]!, { ...validCaregivers[1]!, rank: 1 }]
    await expect(pediatricModeService.upsert(7, dup, 9)).rejects.toBeInstanceOf(ValidationError)
  })

  it("upsert rejects invalid permissionLevel", async () => {
    const bad = [{ ...validCaregivers[0]!, permissionLevel: "admin" as any }]
    await expect(pediatricModeService.upsert(7, bad, 9)).rejects.toBeInstanceOf(ValidationError)
  })

  it("upsert creates new version, supersedes prev, redacted snapshot", async () => {
    prismaMock.configVersion.findFirst.mockResolvedValue({ version: 2 } as any)
    prismaMock.configVersion.updateMany.mockResolvedValue({ count: 1 } as any)
    prismaMock.configVersion.create.mockResolvedValue({
      id: 100, patientId: 7, configType: ConfigVersionType.pediatric_mode,
      version: 3, validFrom: new Date(), validTo: null,
      status: ConfigVersionStatus.active, createdBy: 9,
      validatedBy: null, validatedAt: null, createdAt: new Date(),
    } as any)
    const out = await pediatricModeService.upsert(7, validCaregivers, 9)
    expect(out.version).toBe(3)
    expect(prismaMock.configVersion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          patientId: 7, configType: ConfigVersionType.pediatric_mode,
          status: ConfigVersionStatus.active,
        }),
      }),
    )
    // Snapshot redacted : no plaintext name/phone.
    const created = prismaMock.configVersion.create.mock.calls[0]![0]
    const snapshot = (created.data as any).configSnapshot as Array<Record<string, unknown>>
    expect(snapshot).toHaveLength(2)
    for (const s of snapshot) {
      expect(s).not.toHaveProperty("name")
      expect(s).not.toHaveProperty("phone")
      expect(s).toHaveProperty("hasName", true)
      expect(s).toHaveProperty("hasPhone", true)
      expect(s).toHaveProperty("permissionLevel")
    }
  })

  it("getActive audits decrypt failures separately", async () => {
    prismaMock.configVersion.findFirst.mockResolvedValue({
      id: 100, patientId: 7, configType: ConfigVersionType.pediatric_mode,
      version: 1, validFrom: new Date(), validTo: null,
      status: ConfigVersionStatus.active, createdBy: 9,
      validatedBy: null, validatedAt: null, createdAt: new Date(),
      pediatricCaregivers: [
        // Invalid base64 → safeDecryptField returns null.
        {
          id: 1, rank: 1, nameEncrypted: "$$$invalid$$$",
          phoneEncrypted: "$$$invalid$$$",
          relationship: "mother", permissionLevel: "config",
        },
      ],
    } as any)
    const out = await pediatricModeService.getActive(7, 9)
    expect(out.caregivers[0]!.decryptionFailed).toBe(true)
    // Should emit 2 audit rows : read + decrypt.failure.
    expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(2)
    const lastCall = prismaMock.auditLog.create.mock.calls.at(-1)![0]
    expect((lastCall.data as any).metadata.kind).toBe("pediatric.decrypt.failure")
  })

  it("getActive returns empty when no active version", async () => {
    prismaMock.configVersion.findFirst.mockResolvedValue(null)
    const out = await pediatricModeService.getActive(7, 9)
    expect(out.version).toBeNull()
    expect(out.caregivers).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────
// US-2234 — Ramadan mode
// ─────────────────────────────────────────────────────────────

describe("ramadanModeService (US-2234)", () => {
  const valid = {
    ramadanYear: 2026,
    startDate: "2026-03-01", endDate: "2026-03-30",
    sahurTime: "05:30", iftarTime: "18:45",
    allowedFastingHours: 14,
    isfMultiplier: 1.2, icrMultiplier: 1.1,
  }

  it("rejects out-of-range year", async () => {
    await expect(ramadanModeService.upsert(7, { ...valid, ramadanYear: 2099 }, 9))
      .rejects.toBeInstanceOf(ValidationError)
  })

  it("rejects malformed startDate", async () => {
    await expect(ramadanModeService.upsert(7, { ...valid, startDate: "01/03/2026" }, 9))
      .rejects.toBeInstanceOf(ValidationError)
  })

  it("rejects end before start", async () => {
    await expect(ramadanModeService.upsert(7, {
      ...valid, startDate: "2026-03-30", endDate: "2026-03-01",
    }, 9)).rejects.toBeInstanceOf(ValidationError)
  })

  it("rejects duration outside [28-31] days", async () => {
    await expect(ramadanModeService.upsert(7, {
      ...valid, startDate: "2026-03-01", endDate: "2026-04-15", // 45 days
    }, 9)).rejects.toBeInstanceOf(ValidationError)
  })

  it("rejects invalid HH:MM sahurTime", async () => {
    await expect(ramadanModeService.upsert(7, { ...valid, sahurTime: "25:00" }, 9))
      .rejects.toBeInstanceOf(ValidationError)
  })

  it("rejects ISF multiplier out of clinical bounds", async () => {
    await expect(ramadanModeService.upsert(7, { ...valid, isfMultiplier: 2.5 }, 9))
      .rejects.toBeInstanceOf(ValidationError)
    await expect(ramadanModeService.upsert(7, { ...valid, isfMultiplier: 0.3 }, 9))
      .rejects.toBeInstanceOf(ValidationError)
  })

  it("upsert happy path increments version + audits", async () => {
    prismaMock.configVersion.findFirst.mockResolvedValue({ version: 0 } as any)
    prismaMock.configVersion.updateMany.mockResolvedValue({ count: 0 } as any)
    prismaMock.configVersion.create.mockResolvedValue({
      id: 200, patientId: 7, configType: ConfigVersionType.ramadan_mode,
      version: 1, validFrom: new Date(), validTo: null,
      status: ConfigVersionStatus.active, createdBy: 9,
      validatedBy: null, validatedAt: null, createdAt: new Date(),
    } as any)
    const out = await ramadanModeService.upsert(7, valid, 9)
    expect(out.version).toBe(1)
    expect(prismaMock.auditLog.create).toHaveBeenCalled()
  })

  it("getActive deserializes snapshot back to config", async () => {
    prismaMock.configVersion.findFirst.mockResolvedValue({
      id: 200, patientId: 7, configType: ConfigVersionType.ramadan_mode,
      version: 1, validFrom: new Date(), validTo: null,
      status: ConfigVersionStatus.active, createdBy: 9,
      validatedBy: null, validatedAt: null, createdAt: new Date(),
      configSnapshot: valid,
    } as any)
    const out = await ramadanModeService.getActive(7, 9)
    expect(out.config).toMatchObject({
      ramadanYear: 2026, sahurTime: "05:30", iftarTime: "18:45",
    })
  })
})

// ─────────────────────────────────────────────────────────────
// US-2235 — Travel mode
// ─────────────────────────────────────────────────────────────

describe("travelModeService (US-2235)", () => {
  const valid = {
    destination: "Tokyo",
    timezoneOffsetHours: 8,
    departureDate: "2026-06-15", returnDate: "2026-06-22",
    basalMultiplier: 0.95,
    basalDelayHours: 4,
  }

  it("rejects tz offset out of [-12, 14]", async () => {
    await expect(travelModeService.upsert(7, { ...valid, timezoneOffsetHours: 15 }, 9))
      .rejects.toBeInstanceOf(ValidationError)
    await expect(travelModeService.upsert(7, { ...valid, timezoneOffsetHours: -13 }, 9))
      .rejects.toBeInstanceOf(ValidationError)
  })

  it("rejects return before departure", async () => {
    await expect(travelModeService.upsert(7, {
      ...valid, departureDate: "2026-06-22", returnDate: "2026-06-15",
    }, 9)).rejects.toBeInstanceOf(ValidationError)
  })

  it("rejects trip > 365 days", async () => {
    await expect(travelModeService.upsert(7, {
      ...valid, departureDate: "2026-01-01", returnDate: "2027-06-15",
    }, 9)).rejects.toBeInstanceOf(ValidationError)
  })

  it("rejects basal multiplier out of clinical bounds", async () => {
    await expect(travelModeService.upsert(7, { ...valid, basalMultiplier: 2.0 }, 9))
      .rejects.toBeInstanceOf(ValidationError)
    await expect(travelModeService.upsert(7, { ...valid, basalMultiplier: 0.3 }, 9))
      .rejects.toBeInstanceOf(ValidationError)
  })

  it("upsert happy path", async () => {
    prismaMock.configVersion.findFirst.mockResolvedValue(null)
    prismaMock.configVersion.updateMany.mockResolvedValue({ count: 0 } as any)
    prismaMock.configVersion.create.mockResolvedValue({
      id: 300, patientId: 7, configType: ConfigVersionType.travel_mode,
      version: 1, validFrom: new Date(), validTo: null,
      status: ConfigVersionStatus.active, createdBy: 9,
      validatedBy: null, validatedAt: null, createdAt: new Date(),
    } as any)
    const out = await travelModeService.upsert(7, valid, 9)
    expect(out.version).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────
// computeBasalProtocol — clinical helper
// ─────────────────────────────────────────────────────────────

describe("computeBasalProtocol", () => {
  it("returns identity for |offset| < 3h", () => {
    expect(computeBasalProtocol(0)).toEqual({ basalMultiplier: 1.0, basalDelayHours: 0 })
    expect(computeBasalProtocol(2)).toEqual({ basalMultiplier: 1.0, basalDelayHours: 0 })
    expect(computeBasalProtocol(-2)).toEqual({ basalMultiplier: 1.0, basalDelayHours: 0 })
  })

  it("reduces basal eastbound (positive offset)", () => {
    const out = computeBasalProtocol(8)
    expect(out.basalMultiplier).toBeLessThan(1.0)
    expect(out.basalMultiplier).toBeGreaterThanOrEqual(0.9)
  })

  it("increases basal westbound (negative offset)", () => {
    const out = computeBasalProtocol(-8)
    expect(out.basalMultiplier).toBeGreaterThan(1.0)
    expect(out.basalMultiplier).toBeLessThanOrEqual(1.1)
  })

  it("caps adjustment at ±10% regardless of offset magnitude", () => {
    const out = computeBasalProtocol(14)
    expect(out.basalMultiplier).toBeGreaterThanOrEqual(0.9)
    expect(out.basalMultiplier).toBeLessThanOrEqual(0.95)
  })
})

// ─────────────────────────────────────────────────────────────
// patientModeWorkflow — validate + deactivate + history
// ─────────────────────────────────────────────────────────────

describe("patientModeWorkflow", () => {
  it("validate refuses non-mode configType", async () => {
    prismaMock.configVersion.findUnique.mockResolvedValue({
      id: 1, configType: ConfigVersionType.emergency_contacts,
      validatedAt: null, status: ConfigVersionStatus.active,
    } as any)
    await expect(patientModeWorkflow.validate(1, 9))
      .rejects.toBeInstanceOf(ValidationError)
  })

  it("validate refuses already-validated row", async () => {
    prismaMock.configVersion.findUnique.mockResolvedValue({
      id: 1, configType: ConfigVersionType.pediatric_mode,
      validatedAt: new Date(), status: ConfigVersionStatus.active,
    } as any)
    await expect(patientModeWorkflow.validate(1, 9))
      .rejects.toBeInstanceOf(ValidationError)
  })

  it("validate refuses non-active row", async () => {
    prismaMock.configVersion.findUnique.mockResolvedValue({
      id: 1, configType: ConfigVersionType.pediatric_mode,
      validatedAt: null, status: ConfigVersionStatus.superseded,
    } as any)
    await expect(patientModeWorkflow.validate(1, 9))
      .rejects.toBeInstanceOf(ValidationError)
  })

  it("validate happy path sets validatedBy + validatedAt", async () => {
    prismaMock.configVersion.findUnique.mockResolvedValue({
      id: 1, patientId: 7, configType: ConfigVersionType.pediatric_mode,
      version: 1, validatedAt: null, status: ConfigVersionStatus.active,
    } as any)
    prismaMock.configVersion.update.mockResolvedValue({
      id: 1, patientId: 7, configType: ConfigVersionType.pediatric_mode,
      version: 1, validFrom: new Date(), validTo: null,
      status: ConfigVersionStatus.active, createdBy: 5,
      validatedBy: 9, validatedAt: new Date(), createdAt: new Date(),
    } as any)
    const out = await patientModeWorkflow.validate(1, 9)
    expect(out.validatedBy).toBe(9)
    expect(out.validatedAt).not.toBeNull()
  })

  it("validate throws NotFoundError when missing", async () => {
    prismaMock.configVersion.findUnique.mockResolvedValue(null)
    await expect(patientModeWorkflow.validate(999, 9))
      .rejects.toBeInstanceOf(NotFoundError)
  })

  it("deactivate is idempotent — returns { archived:false } when no active", async () => {
    prismaMock.configVersion.findFirst.mockResolvedValue(null)
    const out = await patientModeWorkflow.deactivate(
      7, ConfigVersionType.ramadan_mode, 9,
    )
    expect(out.archived).toBe(false)
    expect(prismaMock.configVersion.update).not.toHaveBeenCalled()
  })

  it("deactivate archives + audits when active row exists", async () => {
    prismaMock.configVersion.findFirst.mockResolvedValue({
      id: 1, patientId: 7, configType: ConfigVersionType.ramadan_mode, version: 1,
    } as any)
    prismaMock.configVersion.update.mockResolvedValue({} as any)
    const out = await patientModeWorkflow.deactivate(
      7, ConfigVersionType.ramadan_mode, 9,
    )
    expect(out.archived).toBe(true)
    const updateCall = prismaMock.configVersion.update.mock.calls[0]![0]
    expect((updateCall.data as any).status).toBe(ConfigVersionStatus.archived)
  })

  it("deactivate rejects non-mode configType", async () => {
    await expect(patientModeWorkflow.deactivate(
      7, ConfigVersionType.emergency_contacts, 9,
    )).rejects.toBeInstanceOf(ValidationError)
  })

  it("listHistory rejects non-mode configType", async () => {
    await expect(patientModeWorkflow.listHistory(
      7, ConfigVersionType.alert_thresholds, 9,
    )).rejects.toBeInstanceOf(ValidationError)
  })

  it("listHistory returns rows sorted DESC + audits", async () => {
    prismaMock.configVersion.findMany.mockResolvedValue([
      {
        id: 3, patientId: 7, configType: ConfigVersionType.travel_mode,
        version: 3, validFrom: new Date(), validTo: null,
        status: ConfigVersionStatus.active, createdBy: 9,
        validatedBy: null, validatedAt: null, createdAt: new Date(),
      },
      {
        id: 2, patientId: 7, configType: ConfigVersionType.travel_mode,
        version: 2, validFrom: new Date(), validTo: new Date(),
        status: ConfigVersionStatus.superseded, createdBy: 9,
        validatedBy: null, validatedAt: null, createdAt: new Date(),
      },
    ] as any)
    const out = await patientModeWorkflow.listHistory(
      7, ConfigVersionType.travel_mode, 9,
    )
    expect(out).toHaveLength(2)
    expect(out[0]!.version).toBe(3)
  })
})
