/**
 * @description Groupe 1 — US-2244 Device sync status unit tests.
 *
 * Couvre :
 *   - computeStatus aux seuils (4min=ok, 5min=late, 30min=late, 31min=critical)
 *   - getStatus : RBAC + aggregate MAX(lastSyncAt) sur tous les devices
 *   - cohortStatus : groupBy patientId + filtre statuses + tri critical-first
 *   - never_synced quand lastSyncAt=null
 */
import { describe, it, expect, beforeEach } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"
import {
  deviceSyncStatusService,
  SyncStatusAccessError,
  SYNC_STATUS_BOUNDS,
} from "@/lib/services/device-sync-status.service"

/**
 * Prisma 7 `groupBy` overload n'est pas inférable par vitest-mock-extended ;
 * cast typé pour exposer `mockResolvedValue`. Pattern PR #406.
 */
const pmGroupBy = prismaMock.patientDevice.groupBy as unknown as {
  mockResolvedValue: (v: unknown) => void
}

beforeEach(() => {
  prismaMock.auditLog.create.mockResolvedValue({} as any)
})

describe("computeStatus — seuils OK/LATE/CRITICAL", () => {
  const now = Date.now()
  const { computeStatus } = deviceSyncStatusService

  it("null → never_synced", () => {
    expect(computeStatus(null, now)).toEqual({
      status: "never_synced", minutesSinceLastSync: null,
    })
  })

  it("4 min ago → ok", () => {
    const r = computeStatus(new Date(now - 4 * 60_000), now)
    expect(r.status).toBe("ok")
    expect(r.minutesSinceLastSync).toBe(4)
  })

  it("5 min ago → late (boundary inclusive)", () => {
    const r = computeStatus(new Date(now - 5 * 60_000), now)
    expect(r.status).toBe("late")
  })

  it("30 min ago → late (upper boundary inclusive)", () => {
    const r = computeStatus(new Date(now - 30 * 60_000), now)
    expect(r.status).toBe("late")
  })

  it("31 min ago → critical", () => {
    const r = computeStatus(new Date(now - 31 * 60_000), now)
    expect(r.status).toBe("critical")
  })

  it("3h ago → critical", () => {
    const r = computeStatus(new Date(now - 3 * 60 * 60_000), now)
    expect(r.status).toBe("critical")
    expect(r.minutesSinceLastSync).toBe(180)
  })
})

describe("getStatus (US-2244)", () => {
  it("VIEWER own patient — returns status from MAX(lastSyncAt)", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 42 } as any)
    const lastSync = new Date(Date.now() - 2 * 60_000)
    prismaMock.patientDevice.aggregate.mockResolvedValue({
      _max: { lastSyncAt: lastSync },
    } as any)
    const out = await deviceSyncStatusService.getStatus(42, 9, "VIEWER")
    expect(out.patientId).toBe(42)
    expect(out.status).toBe("ok")
    expect(out.lastSyncAt).toEqual(lastSync)
  })

  it("VIEWER cross-patient — throws", async () => {
    prismaMock.patient.findFirst.mockResolvedValue(null)
    await expect(deviceSyncStatusService.getStatus(99, 9, "VIEWER"))
      .rejects.toBeInstanceOf(SyncStatusAccessError)
  })

  it("DOCTOR without link — throws", async () => {
    prismaMock.patientReferent.findFirst.mockResolvedValue(null)
    await expect(deviceSyncStatusService.getStatus(42, 9, "DOCTOR"))
      .rejects.toBeInstanceOf(SyncStatusAccessError)
  })

  it("never_synced when no devices have lastSyncAt", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 42 } as any)
    prismaMock.patientDevice.aggregate.mockResolvedValue({
      _max: { lastSyncAt: null },
    } as any)
    const out = await deviceSyncStatusService.getStatus(42, 9, "VIEWER")
    expect(out.status).toBe("never_synced")
    expect(out.lastSyncAt).toBeNull()
    expect(out.minutesSinceLastSync).toBeNull()
  })

  it("audit includes status in metadata", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 42 } as any)
    prismaMock.patientDevice.aggregate.mockResolvedValue({
      _max: { lastSyncAt: new Date(Date.now() - 60 * 60_000) },
    } as any)
    await deviceSyncStatusService.getStatus(42, 9, "VIEWER")
    const meta = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(meta.metadata.kind).toBe("device_sync_status.read.patient")
    expect(meta.metadata.patientId).toBe(42)
    expect(meta.metadata.status).toBe("critical")
    expect(meta.metadata.minutesSinceLastSync).toBe(60)
  })
})

describe("cohortStatus (US-2244)", () => {
  it("ADMIN cohort = all (no patientId IN filter)", async () => {
    pmGroupBy.mockResolvedValue([] as any)
    await deviceSyncStatusService.cohortStatus({}, 9, "ADMIN")
    const call = (prismaMock.patientDevice.groupBy as any).mock.calls[0][0]
    expect(call.where.patientId).toBeUndefined()
  })

  it("DOCTOR cohort = patients via PatientReferent (F6)", async () => {
    prismaMock.patientReferent.findMany.mockResolvedValue([
      { patientId: 42 }, { patientId: 99 },
    ] as any)
    pmGroupBy.mockResolvedValue([] as any)
    await deviceSyncStatusService.cohortStatus({}, 9, "DOCTOR")
    const call = (prismaMock.patientDevice.groupBy as any).mock.calls[0][0]
    expect(call.where.patientId).toEqual({ in: [42, 99] })
  })

  it("ordering: critical first, then late, never_synced, ok", async () => {
    const now = Date.now()
    pmGroupBy.mockResolvedValue([
      { patientId: 1, _max: { lastSyncAt: new Date(now - 60_000) } },          // ok
      { patientId: 2, _max: { lastSyncAt: new Date(now - 2 * 60 * 60_000) } }, // critical
      { patientId: 3, _max: { lastSyncAt: null } },                              // never_synced
      { patientId: 4, _max: { lastSyncAt: new Date(now - 10 * 60_000) } },     // late
    ] as any)
    const out = await deviceSyncStatusService.cohortStatus({}, 9, "ADMIN")
    expect(out.map((r) => r.status)).toEqual([
      "critical", "late", "never_synced", "ok",
    ])
  })

  it("filter statuses=critical only", async () => {
    const now = Date.now()
    pmGroupBy.mockResolvedValue([
      { patientId: 1, _max: { lastSyncAt: new Date(now - 60_000) } },
      { patientId: 2, _max: { lastSyncAt: new Date(now - 2 * 60 * 60_000) } },
      { patientId: 3, _max: { lastSyncAt: new Date(now - 10 * 60_000) } },
    ] as any)
    const out = await deviceSyncStatusService.cohortStatus({
      statuses: ["critical"],
    }, 9, "ADMIN")
    expect(out).toHaveLength(1)
    expect(out[0]!.patientId).toBe(2)
    expect(out[0]!.status).toBe("critical")
  })

  it("limit capped at MAX_COHORT_LIMIT", async () => {
    pmGroupBy.mockResolvedValue(
      Array.from({ length: 600 }, (_, i) => ({
        patientId: i, _max: { lastSyncAt: null },
      })) as any,
    )
    const out = await deviceSyncStatusService.cohortStatus({ limit: 9999 }, 9, "ADMIN")
    expect(out).toHaveLength(SYNC_STATUS_BOUNDS.MAX_COHORT_LIMIT)
  })

  it("audit row resource=DEVICE, pas de resourceId, metadata avec count + scope=all", async () => {
    pmGroupBy.mockResolvedValue([] as any)
    await deviceSyncStatusService.cohortStatus({}, 9, "ADMIN")
    const meta = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(meta.resource).toBe("DEVICE")
    expect(meta.resourceId).toBeNull()
    expect(meta.metadata.kind).toBe("device_sync_status.read.cohort")
    expect(meta.metadata.count).toBe(0)
    // M4 (review re-1) — scope discriminated union typé.
    expect(meta.metadata.scope).toBe("all")
    expect(meta.metadata.adminEnumerationLimited).toBe(true)
  })

  // H3 (review re-1 PR #408) — patients sans device apparaissent comme never_synced.
  it("H3 — DOCTOR cohort inclut les patients sans device (never_synced)", async () => {
    prismaMock.patientReferent.findMany.mockResolvedValue([
      { patientId: 42 }, { patientId: 99 }, { patientId: 100 },
    ] as any)
    // groupBy ne retourne que les patients ayant ≥1 device.
    pmGroupBy.mockResolvedValue([
      { patientId: 42, _max: { lastSyncAt: new Date() } },
    ] as any)
    const out = await deviceSyncStatusService.cohortStatus({}, 9, "DOCTOR")
    expect(out).toHaveLength(3)
    const byId = Object.fromEntries(out.map((r) => [r.patientId, r.status]))
    expect(byId[42]).toBe("ok")
    expect(byId[99]).toBe("never_synced")
    expect(byId[100]).toBe("never_synced")
  })

  it("H3 — audit scope=scoped + accessibleCount pour DOCTOR", async () => {
    prismaMock.patientReferent.findMany.mockResolvedValue([
      { patientId: 42 }, { patientId: 99 },
    ] as any)
    pmGroupBy.mockResolvedValue([] as any)
    await deviceSyncStatusService.cohortStatus({}, 9, "DOCTOR")
    const meta = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(meta.metadata.scope).toBe("scoped")
    expect(meta.metadata.accessibleCount).toBe(2)
    expect(meta.metadata.adminEnumerationLimited).toBeUndefined()
    expect(meta.metadata.accessibleTruncated).toBeUndefined()
  })

  // NEW-M2 (review re-2) — soft-cap 2000 patients accessibles.
  it("NEW-M2 — audit accessibleTruncated=true quand DOCTOR > 2000 patients", async () => {
    // 3000 patients accessibles → cap à 2000 côté enumeration.
    const ids = Array.from({ length: 3000 }, (_, i) => ({ patientId: i + 1 }))
    prismaMock.patientReferent.findMany.mockResolvedValue(ids as any)
    pmGroupBy.mockResolvedValue([] as any)
    await deviceSyncStatusService.cohortStatus({}, 9, "DOCTOR")
    const meta = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(meta.metadata.accessibleTruncated).toBe(true)
    // accessibleCount = vraie taille (forensique correcte).
    expect(meta.metadata.accessibleCount).toBe(3000)
  })

  it("VIEWER no patient → returns [] without groupBy call", async () => {
    prismaMock.patient.findFirst.mockResolvedValue(null)
    const out = await deviceSyncStatusService.cohortStatus({}, 9, "VIEWER")
    expect(out).toEqual([])
    expect(prismaMock.patientDevice.groupBy).not.toHaveBeenCalled()
  })
})
