/**
 * @description Groupe 6 Batch 1 — Activity service unit tests.
 *
 * Couvre :
 *   - US-2059 : list/create/update/delete + RBAC VIEWER own / NURSE+ cabinet
 *   - US-2060 / 2061 : bulkSync HealthKit/Google Fit avec dedup P2002
 *   - Validation bornes cliniques (steps, calories, heart rate, etc.)
 *   - Immutabilité entries non-manual (capteur)
 *   - Audit US-2268 pivot patientId
 */
import { describe, it, expect, beforeEach } from "vitest"
import { Prisma } from "@prisma/client"
import { prismaMock } from "../helpers/prisma-mock"
import {
  activityService,
  ActivityAccessError,
  ActivityNotFoundError,
  ACTIVITY_BOUNDS,
} from "@/lib/services/activity.service"

const baseEvent = {
  id: "00000000-0000-4000-8000-000000000001",
  patientId: 42,
  eventDate: new Date("2026-05-15T08:30:00Z"),
  eventTypes: ["physicalActivity"] as const,
  glycemiaValue: null, carbohydrates: null, bolusDose: null, basalDose: null,
  activityType: "walk",
  activityDuration: 45,
  activityIntensity: "moderate" as const,
  activitySteps: 5800,
  activityDistanceM: 4200,
  activityCalories: 250,
  activityHeartRateAvg: 110,
  activitySource: "manual" as const,
  externalSyncId: null,
  contextType: null, weight: null, hba1c: null, ketones: null,
  systolicPressure: null, diastolicPressure: null,
  comment: null,
  validatedAt: null, validatedBy: null,
  createdAt: new Date(), updatedAt: new Date(),
}

beforeEach(() => {
  prismaMock.auditLog.create.mockResolvedValue({} as any)
  prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock))
})

// ─── RBAC ───────────────────────────────────────────────────────────

describe("RBAC", () => {
  it("VIEWER rejected when targeting another patient", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 99 } as any)
    await expect(activityService.listByPatient(42, {}, 9, "VIEWER"))
      .rejects.toBeInstanceOf(ActivityAccessError)
  })

  it("VIEWER accepted on own patient", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 42 } as any)
    prismaMock.diabetesEvent.findMany.mockResolvedValue([] as any)
    const out = await activityService.listByPatient(42, {}, 9, "VIEWER")
    expect(out).toEqual([])
  })

  it("DOCTOR rejected without PatientService link", async () => {
    prismaMock.patientService.findFirst.mockResolvedValue(null)
    await expect(activityService.listByPatient(42, {}, 9, "DOCTOR"))
      .rejects.toBeInstanceOf(ActivityAccessError)
  })

  it("ADMIN bypass — finds patient via canAccessPatient", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 42 } as any)
    prismaMock.diabetesEvent.findMany.mockResolvedValue([] as any)
    const out = await activityService.listByPatient(42, {}, 9, "ADMIN")
    expect(out).toEqual([])
  })
})

// ─── create (US-2059) ───────────────────────────────────────────────

describe("create — manual entry (US-2059)", () => {
  beforeEach(() => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 42 } as any)
    prismaMock.diabetesEvent.create.mockResolvedValue(baseEvent as any)
  })

  it("creates manual activity event", async () => {
    const out = await activityService.create(42, {
      eventDate: new Date("2026-05-15T08:30:00Z"),
      activityType: "walk",
      activityDuration: 45,
    }, 9, "VIEWER")
    expect(out.activityType).toBe("walk")
    expect(out.activitySource).toBe("manual")
    expect(prismaMock.diabetesEvent.create).toHaveBeenCalled()
    const callArg = prismaMock.diabetesEvent.create.mock.calls[0]![0]!
    expect((callArg.data as any).eventTypes).toEqual(["physicalActivity"])
    expect((callArg.data as any).activitySource).toBe("manual")
  })

  it("rejects unknown activityType", async () => {
    await expect(activityService.create(42, {
      eventDate: new Date(),
      activityType: "skydiving" as any,
    }, 9, "VIEWER")).rejects.toMatchObject({ field: "activityType" })
  })

  it("rejects negative steps", async () => {
    await expect(activityService.create(42, {
      eventDate: new Date(),
      activityType: "walk",
      activitySteps: -1,
    }, 9, "VIEWER")).rejects.toMatchObject({ field: "activitySteps" })
  })

  it("rejects HR < 30 bpm", async () => {
    await expect(activityService.create(42, {
      eventDate: new Date(),
      activityType: "walk",
      activityHeartRateAvg: 20,
    }, 9, "VIEWER")).rejects.toMatchObject({ field: "activityHeartRateAvg" })
  })

  it("rejects HR > 250 bpm", async () => {
    await expect(activityService.create(42, {
      eventDate: new Date(),
      activityType: "walk",
      activityHeartRateAvg: 260,
    }, 9, "VIEWER")).rejects.toMatchObject({ field: "activityHeartRateAvg" })
  })

  it("rejects duration > 24h", async () => {
    await expect(activityService.create(42, {
      eventDate: new Date(),
      activityType: "walk",
      activityDuration: 1441,
    }, 9, "VIEWER")).rejects.toMatchObject({ field: "activityDuration" })
  })

  it("audit row contains patientId pivot + kind=activity.create", async () => {
    await activityService.create(42, {
      eventDate: new Date(),
      activityType: "run",
    }, 9, "VIEWER")
    const meta = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(meta.metadata.kind).toBe("activity.create")
    expect(meta.metadata.patientId).toBe(42)
    expect(meta.metadata.activityType).toBe("run")
    expect(meta.metadata.source).toBe("manual")
  })
})

// ─── update — immutability for sensor sources ───────────────────────

describe("update — immutable for sensor sources", () => {
  beforeEach(() => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 42 } as any)
  })

  it("allows update on manual entry", async () => {
    prismaMock.diabetesEvent.findUnique.mockResolvedValue(baseEvent as any)
    prismaMock.diabetesEvent.update.mockResolvedValue({
      ...baseEvent, activityDuration: 60,
    } as any)
    const out = await activityService.update(baseEvent.id, {
      activityDuration: 60,
    }, 9, "VIEWER")
    expect(out.activityDuration).toBe(60)
  })

  it("rejects update on healthkit-sourced entry", async () => {
    prismaMock.diabetesEvent.findUnique.mockResolvedValue({
      ...baseEvent, activitySource: "healthkit", externalSyncId: "hk-abc",
    } as any)
    await expect(activityService.update(baseEvent.id, {
      activityDuration: 60,
    }, 9, "VIEWER"))
      .rejects.toMatchObject({ field: "immutableSource:healthkit" })
  })

  it("rejects update on google_fit-sourced entry", async () => {
    prismaMock.diabetesEvent.findUnique.mockResolvedValue({
      ...baseEvent, activitySource: "google_fit", externalSyncId: "gf-xyz",
    } as any)
    await expect(activityService.update(baseEvent.id, {
      activityDuration: 60,
    }, 9, "VIEWER"))
      .rejects.toMatchObject({ field: "immutableSource:google_fit" })
  })

  it("throws NotFound when event has no physicalActivity type", async () => {
    prismaMock.diabetesEvent.findUnique.mockResolvedValue({
      ...baseEvent, eventTypes: ["glycemia"],
    } as any)
    await expect(activityService.update(baseEvent.id, {
      activityDuration: 60,
    }, 9, "VIEWER"))
      .rejects.toBeInstanceOf(ActivityNotFoundError)
  })

  it("throws NotFound when event missing", async () => {
    prismaMock.diabetesEvent.findUnique.mockResolvedValue(null)
    await expect(activityService.update("not-found-id", {
      activityDuration: 60,
    }, 9, "VIEWER")).rejects.toBeInstanceOf(ActivityNotFoundError)
  })
})

// ─── delete ─────────────────────────────────────────────────────────

describe("delete", () => {
  it("deletes manual entry + audit", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 42 } as any)
    prismaMock.diabetesEvent.findUnique.mockResolvedValue(baseEvent as any)
    prismaMock.diabetesEvent.delete.mockResolvedValue(baseEvent as any)
    await activityService.delete(baseEvent.id, 9, "VIEWER")
    expect(prismaMock.diabetesEvent.delete).toHaveBeenCalled()
    const meta = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(meta.metadata.kind).toBe("activity.delete")
    expect(meta.metadata.patientId).toBe(42)
  })

  it("404 when event not physicalActivity", async () => {
    prismaMock.diabetesEvent.findUnique.mockResolvedValue({
      ...baseEvent, eventTypes: ["glycemia"],
    } as any)
    await expect(activityService.delete(baseEvent.id, 9, "VIEWER"))
      .rejects.toBeInstanceOf(ActivityNotFoundError)
  })
})

// ─── bulkSync (US-2060 + US-2061) ───────────────────────────────────

describe("bulkSync (US-2060 / 2061) — mobile dedup", () => {
  const baseSyncItem = {
    externalSyncId: "hk-uuid-1",
    eventDate: new Date("2026-05-15T08:30:00Z"),
    activityType: "walk" as const,
    activityDuration: 30,
    activitySteps: 3500,
  }

  beforeEach(() => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 42 } as any)
  })

  it("returns inserted=0 / skipped=0 on empty array", async () => {
    const out = await activityService.bulkSync(42, "healthkit", [], 9, "VIEWER")
    expect(out).toEqual({ inserted: 0, skipped: 0 })
    expect(prismaMock.diabetesEvent.create).not.toHaveBeenCalled()
  })

  it("inserts 3 new items + audits", async () => {
    prismaMock.diabetesEvent.create.mockResolvedValue(baseEvent as any)
    const items = Array.from({ length: 3 }, (_, i) => ({
      ...baseSyncItem, externalSyncId: `hk-uuid-${i}`,
    }))
    const out = await activityService.bulkSync(42, "healthkit", items, 9, "VIEWER")
    expect(out).toEqual({ inserted: 3, skipped: 0 })
    expect(prismaMock.diabetesEvent.create).toHaveBeenCalledTimes(3)
    const meta = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(meta.metadata.kind).toBe("activity.sync")
    expect(meta.metadata.inserted).toBe(3)
    expect(meta.metadata.skipped).toBe(0)
    expect(meta.metadata.source).toBe("healthkit")
  })

  it("silently skips duplicates via P2002 unique violation", async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed",
      { code: "P2002", clientVersion: "test" } as any,
    )
    prismaMock.diabetesEvent.create
      .mockResolvedValueOnce(baseEvent as any)
      .mockRejectedValueOnce(p2002) // 2nd item = duplicate
      .mockResolvedValueOnce(baseEvent as any)
    const items = Array.from({ length: 3 }, (_, i) => ({
      ...baseSyncItem, externalSyncId: `hk-uuid-${i}`,
    }))
    const out = await activityService.bulkSync(42, "healthkit", items, 9, "VIEWER")
    expect(out).toEqual({ inserted: 2, skipped: 1 })
  })

  it("propagates non-P2002 errors (don't swallow)", async () => {
    const fatal = new Error("DB down")
    prismaMock.diabetesEvent.create.mockRejectedValue(fatal)
    await expect(activityService.bulkSync(42, "healthkit", [baseSyncItem], 9, "VIEWER"))
      .rejects.toThrow("DB down")
  })

  it("rejects bulk > MAX_BULK_ITEMS", async () => {
    const items = Array.from({ length: ACTIVITY_BOUNDS.MAX_BULK_ITEMS + 1 }, (_, i) => ({
      ...baseSyncItem, externalSyncId: `hk-${i}`,
    }))
    await expect(activityService.bulkSync(42, "healthkit", items, 9, "VIEWER"))
      .rejects.toMatchObject({ field: "bulkItemsTooMany" })
  })

  it("rejects items with empty externalSyncId", async () => {
    await expect(activityService.bulkSync(42, "healthkit", [{
      ...baseSyncItem, externalSyncId: "",
    }], 9, "VIEWER")).rejects.toMatchObject({ field: "externalSyncId" })
  })

  it("rejects items with invalid activityType", async () => {
    await expect(activityService.bulkSync(42, "google_fit", [{
      ...baseSyncItem, activityType: "skydiving" as any,
    }], 9, "VIEWER")).rejects.toMatchObject({ field: "activityType" })
  })

  it("propagates source to created events", async () => {
    prismaMock.diabetesEvent.create.mockResolvedValue(baseEvent as any)
    await activityService.bulkSync(42, "google_fit", [baseSyncItem], 9, "VIEWER")
    const callArg = prismaMock.diabetesEvent.create.mock.calls[0]![0]!
    expect((callArg.data as any).activitySource).toBe("google_fit")
    expect((callArg.data as any).externalSyncId).toBe("hk-uuid-1")
  })
})

// ─── list — time window ─────────────────────────────────────────────

describe("list — time window + audit", () => {
  beforeEach(() => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 42 } as any)
  })

  it("filters by eventDate range", async () => {
    prismaMock.diabetesEvent.findMany.mockResolvedValue([baseEvent] as any)
    const from = new Date("2026-05-01")
    const to = new Date("2026-05-31")
    await activityService.listByPatient(42, { from, to }, 9, "VIEWER")
    const call = prismaMock.diabetesEvent.findMany.mock.calls[0]![0]!
    expect((call.where as any).eventDate.gte).toEqual(from)
    expect((call.where as any).eventDate.lte).toEqual(to)
  })

  it("audit metadata includes count + patientId pivot", async () => {
    prismaMock.diabetesEvent.findMany.mockResolvedValue([baseEvent, baseEvent] as any)
    await activityService.listByPatient(42, {}, 9, "VIEWER")
    const meta = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(meta.metadata.kind).toBe("activity.list")
    expect(meta.metadata.patientId).toBe(42)
    expect(meta.metadata.count).toBe(2)
  })
})
