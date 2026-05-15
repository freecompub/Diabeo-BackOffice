/**
 * @description Groupe 1 — US-2243 Device supervision unit tests.
 *
 * Couvre :
 *   - listByPatient : RBAC VIEWER own / NURSE+ cabinet via canAccessPatient
 *   - listCohort : getAccessiblePatientIds + filtres batteryLow/expiring/category
 *   - Computed fields : batteryLow (<20), sensorExpiringSoon (≤+3j)
 *   - Audit US-2268 pivot patientId
 */
import { describe, it, expect, beforeEach } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"
import {
  deviceSupervisionService,
  DeviceSupervisionAccessError,
  SUPERVISION_BOUNDS,
} from "@/lib/services/device-supervision.service"

const baseDevice = {
  id: 100, patientId: 42,
  brand: "Dexcom", name: "G7", model: "G7", sn: "ABC123",
  date: new Date("2026-01-15"), type: "cgm", category: "cgm" as const,
  connectionTypes: ["bluetooth"], modelIdentifier: "DXCM-G7",
  batteryLevel: 80,
  sensorExpiresAt: new Date(Date.now() + 5 * 86_400_000),
  lastSyncAt: new Date(Date.now() - 60_000),
}

beforeEach(() => {
  prismaMock.auditLog.create.mockResolvedValue({} as any)
})

describe("listByPatient (US-2243)", () => {
  it("VIEWER on own patient — returns devices", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 42 } as any)
    prismaMock.patientDevice.findMany.mockResolvedValue([baseDevice] as any)
    const out = await deviceSupervisionService.listByPatient(42, 9, "VIEWER")
    expect(out).toHaveLength(1)
    expect(out[0]!.id).toBe(100)
    expect(out[0]!.batteryLow).toBe(false)
    expect(out[0]!.sensorExpiringSoon).toBe(false)
  })

  it("VIEWER on other patient — throws", async () => {
    prismaMock.patient.findFirst.mockResolvedValue(null)
    await expect(deviceSupervisionService.listByPatient(99, 9, "VIEWER"))
      .rejects.toBeInstanceOf(DeviceSupervisionAccessError)
  })

  it("DOCTOR without PatientService link — throws", async () => {
    prismaMock.patientService.findFirst.mockResolvedValue(null)
    await expect(deviceSupervisionService.listByPatient(42, 9, "DOCTOR"))
      .rejects.toBeInstanceOf(DeviceSupervisionAccessError)
  })

  it("ADMIN bypass — finds patient via canAccessPatient", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 42 } as any)
    prismaMock.patientDevice.findMany.mockResolvedValue([] as any)
    const out = await deviceSupervisionService.listByPatient(42, 9, "ADMIN")
    expect(out).toEqual([])
  })

  it("batteryLow computed correctly at threshold", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 42 } as any)
    prismaMock.patientDevice.findMany.mockResolvedValue([
      { ...baseDevice, batteryLevel: 19 },
      { ...baseDevice, id: 101, batteryLevel: 20 },
      { ...baseDevice, id: 102, batteryLevel: null },
    ] as any)
    const out = await deviceSupervisionService.listByPatient(42, 9, "VIEWER")
    expect(out[0]!.batteryLow).toBe(true)  // 19 < 20
    expect(out[1]!.batteryLow).toBe(false) // 20 not <20
    expect(out[2]!.batteryLow).toBe(false) // null = unknown
  })

  it("sensorExpiringSoon computed correctly at boundary", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 42 } as any)
    prismaMock.patientDevice.findMany.mockResolvedValue([
      { ...baseDevice, sensorExpiresAt: new Date(Date.now() + 2 * 86_400_000) },
      { ...baseDevice, id: 101, sensorExpiresAt: new Date(Date.now() + 5 * 86_400_000) },
      { ...baseDevice, id: 102, sensorExpiresAt: null },
    ] as any)
    const out = await deviceSupervisionService.listByPatient(42, 9, "VIEWER")
    expect(out[0]!.sensorExpiringSoon).toBe(true)  // 2j < 3j
    expect(out[1]!.sensorExpiringSoon).toBe(false) // 5j > 3j
    expect(out[2]!.sensorExpiringSoon).toBe(false) // null
  })

  it("audit US-2268 pivot patientId + count", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 42 } as any)
    prismaMock.patientDevice.findMany.mockResolvedValue([baseDevice, baseDevice] as any)
    await deviceSupervisionService.listByPatient(42, 9, "VIEWER")
    const meta = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(meta.resourceId).toBe("42")
    expect(meta.metadata.kind).toBe("device_supervision.read.patient")
    expect(meta.metadata.patientId).toBe(42)
    expect(meta.metadata.count).toBe(2)
  })
})

describe("listCohort (US-2243)", () => {
  it("VIEWER cohort = [own patient only]", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 42 } as any)
    prismaMock.patientDevice.findMany.mockResolvedValue([baseDevice] as any)
    const out = await deviceSupervisionService.listCohort({}, 9, "VIEWER")
    expect(out).toHaveLength(1)
    const call = prismaMock.patientDevice.findMany.mock.calls[0]![0]!
    expect((call.where as any).patientId).toEqual({ in: [42] })
  })

  it("VIEWER no patient → returns []", async () => {
    prismaMock.patient.findFirst.mockResolvedValue(null)
    const out = await deviceSupervisionService.listCohort({}, 9, "VIEWER")
    expect(out).toEqual([])
    expect(prismaMock.patientDevice.findMany).not.toHaveBeenCalled()
  })

  it("ADMIN cohort = all (no patientId filter)", async () => {
    prismaMock.patientDevice.findMany.mockResolvedValue([] as any)
    await deviceSupervisionService.listCohort({}, 9, "ADMIN")
    const call = prismaMock.patientDevice.findMany.mock.calls[0]![0]!
    expect((call.where as any).patientId).toBeUndefined()
  })

  it("DOCTOR cohort = patients via PatientService", async () => {
    prismaMock.patientService.findMany.mockResolvedValue([
      { patientId: 42 }, { patientId: 99 },
    ] as any)
    prismaMock.patientDevice.findMany.mockResolvedValue([] as any)
    await deviceSupervisionService.listCohort({}, 9, "DOCTOR")
    const call = prismaMock.patientDevice.findMany.mock.calls[0]![0]!
    expect((call.where as any).patientId).toEqual({ in: [42, 99] })
  })

  it("batteryLow filter applied to where clause", async () => {
    prismaMock.patientDevice.findMany.mockResolvedValue([] as any)
    await deviceSupervisionService.listCohort({ batteryLow: true }, 9, "ADMIN")
    const call = prismaMock.patientDevice.findMany.mock.calls[0]![0]!
    expect((call.where as any).batteryLevel).toEqual({
      lt: SUPERVISION_BOUNDS.BATTERY_LOW_PCT,
    })
  })

  it("sensorExpiringSoon filter applied to where clause", async () => {
    prismaMock.patientDevice.findMany.mockResolvedValue([] as any)
    await deviceSupervisionService.listCohort({ sensorExpiringSoon: true }, 9, "ADMIN")
    const call = prismaMock.patientDevice.findMany.mock.calls[0]![0]!
    expect((call.where as any).sensorExpiresAt.lte).toBeInstanceOf(Date)
    expect((call.where as any).sensorExpiresAt.not).toBeNull()
  })

  it("category filter applied to where clause", async () => {
    prismaMock.patientDevice.findMany.mockResolvedValue([] as any)
    await deviceSupervisionService.listCohort({ category: "cgm" }, 9, "ADMIN")
    const call = prismaMock.patientDevice.findMany.mock.calls[0]![0]!
    expect((call.where as any).category).toBe("cgm")
  })

  it("limit capped at MAX_COHORT_LIMIT", async () => {
    prismaMock.patientDevice.findMany.mockResolvedValue([] as any)
    await deviceSupervisionService.listCohort({ limit: 9999 }, 9, "ADMIN")
    const call = prismaMock.patientDevice.findMany.mock.calls[0]![0]!
    expect(call.take).toBe(SUPERVISION_BOUNDS.MAX_COHORT_LIMIT)
  })

  it("audit metadata includes filters + count", async () => {
    prismaMock.patientDevice.findMany.mockResolvedValue([baseDevice] as any)
    await deviceSupervisionService.listCohort({
      batteryLow: true, sensorExpiringSoon: true, category: "cgm",
    }, 9, "ADMIN")
    const meta = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(meta.metadata.kind).toBe("device_supervision.read.cohort")
    expect(meta.metadata.batteryLow).toBe(true)
    expect(meta.metadata.sensorExpiringSoon).toBe(true)
    expect(meta.metadata.category).toBe("cgm")
    expect(meta.metadata.accessibleScope).toBe("all")
  })
})
