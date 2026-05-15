/**
 * @description Groupe 6 Batch 1 — Activity service unit tests.
 *
 * Couvre :
 *   - US-2059 : list/create/update/delete + RBAC VIEWER own / NURSE+ cabinet
 *   - US-2060 / 2061 : bulkSync HealthKit/Google Fit avec dedup
 *     `createMany skipDuplicates` (review re-1 H1)
 *   - C1 (review re-1) : comment chiffré AES-256-GCM roundtrip
 *   - C3 (review re-1) : eventDate bornes [-2y, +5min]
 *   - H3 (review re-1) : DELETE bloqué sur sensor entry
 *   - H6 (review re-1) : insertedIds dans audit metadata sync
 *   - M4 (review re-1) : control chars rejetés
 *   - M7 (review re-1) : skipDuplicates uniquement sur external_sync_id
 *   - Validation bornes cliniques (steps, calories, heart rate)
 *   - Immutabilité entries non-manual (capteur)
 *   - Audit US-2268 pivot patientId
 */
import { describe, it, expect, beforeEach } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"
import {
  activityService,
  ActivityAccessError,
  ActivityNotFoundError,
  ACTIVITY_BOUNDS,
} from "@/lib/services/activity.service"
import { encryptField, safeDecryptField } from "@/lib/crypto/fields"

const recentDate = (): Date => new Date(Date.now() - 60_000)

const baseEvent = {
  id: "00000000-0000-4000-8000-000000000001",
  patientId: 42,
  eventDate: recentDate(),
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

// ─── create (US-2059 + C1 encryption) ──────────────────────────────

describe("create — manual entry (US-2059)", () => {
  beforeEach(() => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 42 } as any)
    prismaMock.diabetesEvent.create.mockResolvedValue(baseEvent as any)
  })

  it("creates manual activity event", async () => {
    const out = await activityService.create(42, {
      eventDate: recentDate(),
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

  // C1 (review re-1) — comment chiffré AES-256-GCM avant insert.
  it("C1 — encrypts comment before storage + decrypts in DTO", async () => {
    const plaintext = "Course agréable au parc"
    const encrypted = encryptField(plaintext)
    prismaMock.diabetesEvent.create.mockResolvedValue({
      ...baseEvent, comment: encrypted,
    } as any)
    const out = await activityService.create(42, {
      eventDate: recentDate(),
      activityType: "run",
      comment: plaintext,
    }, 9, "VIEWER")
    const callArg = prismaMock.diabetesEvent.create.mock.calls[0]![0]!
    const storedComment = (callArg.data as any).comment as string
    // Stored value is NOT plaintext.
    expect(storedComment).not.toBe(plaintext)
    // Stored value decrypts back to plaintext.
    expect(safeDecryptField(storedComment)).toBe(plaintext)
    // DTO comment is decrypted to plaintext.
    expect(out.comment).toBe(plaintext)
  })

  it("rejects unknown activityType", async () => {
    await expect(activityService.create(42, {
      eventDate: recentDate(),
      activityType: "skydiving" as any,
    }, 9, "VIEWER")).rejects.toMatchObject({ field: "activityType" })
  })

  it("rejects negative steps", async () => {
    await expect(activityService.create(42, {
      eventDate: recentDate(),
      activityType: "walk",
      activitySteps: -1,
    }, 9, "VIEWER")).rejects.toMatchObject({ field: "activitySteps" })
  })

  it("rejects steps > MAX_STEPS (100k, tightened L3)", async () => {
    await expect(activityService.create(42, {
      eventDate: recentDate(),
      activityType: "walk",
      activitySteps: 100_001,
    }, 9, "VIEWER")).rejects.toMatchObject({ field: "activitySteps" })
  })

  it("rejects HR < 30 bpm", async () => {
    await expect(activityService.create(42, {
      eventDate: recentDate(),
      activityType: "walk",
      activityHeartRateAvg: 20,
    }, 9, "VIEWER")).rejects.toMatchObject({ field: "activityHeartRateAvg" })
  })

  it("rejects HR > 250 bpm", async () => {
    await expect(activityService.create(42, {
      eventDate: recentDate(),
      activityType: "walk",
      activityHeartRateAvg: 260,
    }, 9, "VIEWER")).rejects.toMatchObject({ field: "activityHeartRateAvg" })
  })

  it("rejects duration > 24h", async () => {
    await expect(activityService.create(42, {
      eventDate: recentDate(),
      activityType: "walk",
      activityDuration: 1441,
    }, 9, "VIEWER")).rejects.toMatchObject({ field: "activityDuration" })
  })

  // C3 (review re-1) — eventDate borné.
  it("C3 — rejects eventDate in the future (> +5min)", async () => {
    const future = new Date(Date.now() + 60 * 60_000) // +1h
    await expect(activityService.create(42, {
      eventDate: future,
      activityType: "walk",
    }, 9, "VIEWER")).rejects.toMatchObject({ field: "eventDateFuture" })
  })

  it("C3 — rejects eventDate older than 2 years", async () => {
    const ancient = new Date(Date.now() - 3 * 365 * 86_400_000)
    await expect(activityService.create(42, {
      eventDate: ancient,
      activityType: "walk",
    }, 9, "VIEWER")).rejects.toMatchObject({ field: "eventDatePast" })
  })

  // M4 (review re-1) — control chars dans comment.
  it("M4 — rejects comment containing NUL byte", async () => {
    await expect(activityService.create(42, {
      eventDate: recentDate(),
      activityType: "walk",
      comment: "test\x00malicious",
    }, 9, "VIEWER")).rejects.toMatchObject({ field: "commentControlChars" })
  })

  it("M4 — accepts comment containing newline and tab", async () => {
    prismaMock.diabetesEvent.create.mockResolvedValue(baseEvent as any)
    await expect(activityService.create(42, {
      eventDate: recentDate(),
      activityType: "walk",
      comment: "line1\nline2\twith tab",
    }, 9, "VIEWER")).resolves.toBeTruthy()
  })

  it("audit row contains patientId pivot + kind=activity.create", async () => {
    await activityService.create(42, {
      eventDate: recentDate(),
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

  it("throws NotFound when event has no physicalActivity type", async () => {
    prismaMock.diabetesEvent.findUnique.mockResolvedValue({
      ...baseEvent, eventTypes: ["glycemia"],
    } as any)
    await expect(activityService.update(baseEvent.id, {
      activityDuration: 60,
    }, 9, "VIEWER"))
      .rejects.toBeInstanceOf(ActivityNotFoundError)
  })

  // C1 — update aussi encrypte / decrypte.
  it("C1 — encrypts updated comment", async () => {
    prismaMock.diabetesEvent.findUnique.mockResolvedValue(baseEvent as any)
    prismaMock.diabetesEvent.update.mockResolvedValue(baseEvent as any)
    await activityService.update(baseEvent.id, {
      comment: "updated note",
    }, 9, "VIEWER")
    const updateArg = prismaMock.diabetesEvent.update.mock.calls[0]![0]!
    const storedComment = (updateArg.data as any).comment as string
    expect(storedComment).not.toBe("updated note")
    expect(safeDecryptField(storedComment)).toBe("updated note")
  })
})

// ─── delete — H3 immutability symétrique ────────────────────────────

describe("delete — H3 sensor immutability", () => {
  beforeEach(() => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 42 } as any)
  })

  it("deletes manual entry + audit", async () => {
    prismaMock.diabetesEvent.findUnique.mockResolvedValue(baseEvent as any)
    prismaMock.diabetesEvent.delete.mockResolvedValue(baseEvent as any)
    await activityService.delete(baseEvent.id, 9, "VIEWER")
    expect(prismaMock.diabetesEvent.delete).toHaveBeenCalled()
    const meta = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(meta.metadata.kind).toBe("activity.delete")
    expect(meta.metadata.patientId).toBe(42)
  })

  // H3 (review re-1) — symétrie : DELETE bloqué sur sensor.
  it("H3 — rejects DELETE on healthkit-sourced entry", async () => {
    prismaMock.diabetesEvent.findUnique.mockResolvedValue({
      ...baseEvent, activitySource: "healthkit", externalSyncId: "hk-abc",
    } as any)
    await expect(activityService.delete(baseEvent.id, 9, "VIEWER"))
      .rejects.toMatchObject({ field: "immutableSource:healthkit" })
    expect(prismaMock.diabetesEvent.delete).not.toHaveBeenCalled()
  })

  it("H3 — rejects DELETE on google_fit-sourced entry", async () => {
    prismaMock.diabetesEvent.findUnique.mockResolvedValue({
      ...baseEvent, activitySource: "google_fit", externalSyncId: "gf-xyz",
    } as any)
    await expect(activityService.delete(baseEvent.id, 9, "VIEWER"))
      .rejects.toMatchObject({ field: "immutableSource:google_fit" })
  })

  it("404 when event not physicalActivity", async () => {
    prismaMock.diabetesEvent.findUnique.mockResolvedValue({
      ...baseEvent, eventTypes: ["glycemia"],
    } as any)
    await expect(activityService.delete(baseEvent.id, 9, "VIEWER"))
      .rejects.toBeInstanceOf(ActivityNotFoundError)
  })
})

// ─── bulkSync — H1 createMany + H6 insertedIds ─────────────────────

describe("bulkSync (US-2060 / 2061) — mobile dedup", () => {
  const baseSyncItem = {
    externalSyncId: "hk-uuid-1",
    eventDate: recentDate(),
    activityType: "walk" as const,
    activityDuration: 30,
    activitySteps: 3500,
  }

  beforeEach(() => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 42 } as any)
    prismaMock.diabetesEvent.findMany.mockResolvedValue([] as any)
  })

  it("returns inserted=0 / skipped=0 on empty array", async () => {
    const out = await activityService.bulkSync(42, "healthkit", [], 9, "VIEWER")
    expect(out).toEqual({ inserted: 0, skipped: 0 })
    expect(prismaMock.diabetesEvent.createMany).not.toHaveBeenCalled()
  })

  // H1 (review re-1) — utilise createMany skipDuplicates (1 round-trip).
  it("H1 — uses createMany skipDuplicates (single round-trip)", async () => {
    prismaMock.diabetesEvent.createMany.mockResolvedValue({ count: 3 } as any)
    prismaMock.diabetesEvent.findMany.mockResolvedValue([
      { id: "uuid-a", externalSyncId: "hk-uuid-0" },
      { id: "uuid-b", externalSyncId: "hk-uuid-1" },
      { id: "uuid-c", externalSyncId: "hk-uuid-2" },
    ] as any)
    const items = Array.from({ length: 3 }, (_, i) => ({
      ...baseSyncItem, externalSyncId: `hk-uuid-${i}`,
    }))
    const out = await activityService.bulkSync(42, "healthkit", items, 9, "VIEWER")
    expect(out).toEqual({ inserted: 3, skipped: 0 })
    expect(prismaMock.diabetesEvent.createMany).toHaveBeenCalledTimes(1)
    const call = prismaMock.diabetesEvent.createMany.mock.calls[0]![0]!
    expect((call as any).skipDuplicates).toBe(true)
  })

  it("computes skipped from createMany.count vs items.length", async () => {
    // 5 sent, 3 inserted → 2 dedupped silently.
    prismaMock.diabetesEvent.createMany.mockResolvedValue({ count: 3 } as any)
    prismaMock.diabetesEvent.findMany.mockResolvedValue([
      { id: "u1", externalSyncId: "id-1" },
      { id: "u3", externalSyncId: "id-3" },
      { id: "u5", externalSyncId: "id-5" },
    ] as any)
    const items = Array.from({ length: 5 }, (_, i) => ({
      ...baseSyncItem, externalSyncId: `id-${i + 1}`,
    }))
    const out = await activityService.bulkSync(42, "healthkit", items, 9, "VIEWER")
    expect(out).toEqual({ inserted: 3, skipped: 2 })
  })

  // H6 (review re-1) — audit metadata.insertedIds.
  it("H6 — audit metadata includes insertedIds + counts", async () => {
    prismaMock.diabetesEvent.createMany.mockResolvedValue({ count: 2 } as any)
    prismaMock.diabetesEvent.findMany.mockResolvedValue([
      { id: "uuid-a", externalSyncId: "hk-a" },
      { id: "uuid-b", externalSyncId: "hk-b" },
    ] as any)
    await activityService.bulkSync(42, "healthkit", [
      { ...baseSyncItem, externalSyncId: "hk-a" },
      { ...baseSyncItem, externalSyncId: "hk-b" },
    ], 9, "VIEWER")
    const meta = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(meta.metadata.kind).toBe("activity.sync")
    expect(meta.metadata.inserted).toBe(2)
    expect(meta.metadata.skipped).toBe(0)
    expect(meta.metadata.insertedIds).toEqual(["uuid-a", "uuid-b"])
    expect(meta.metadata.source).toBe("healthkit")
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

  // C3 — eventDate validé aussi en bulkSync.
  it("C3 — rejects sync item with future eventDate", async () => {
    await expect(activityService.bulkSync(42, "healthkit", [{
      ...baseSyncItem, eventDate: new Date(Date.now() + 86_400_000),
    }], 9, "VIEWER")).rejects.toMatchObject({ field: "eventDateFuture" })
  })

  it("propagates source to created events", async () => {
    prismaMock.diabetesEvent.createMany.mockResolvedValue({ count: 1 } as any)
    prismaMock.diabetesEvent.findMany.mockResolvedValue([
      { id: "uuid-1", externalSyncId: "hk-uuid-1" },
    ] as any)
    await activityService.bulkSync(42, "google_fit", [baseSyncItem], 9, "VIEWER")
    const call = prismaMock.diabetesEvent.createMany.mock.calls[0]![0]!
    const data = (call as any).data as Array<{ activitySource: string }>
    expect(data[0]!.activitySource).toBe("google_fit")
  })

  // C1 — bulk sync encrypte aussi le comment.
  it("C1 — bulkSync encrypts comments", async () => {
    prismaMock.diabetesEvent.createMany.mockResolvedValue({ count: 1 } as any)
    prismaMock.diabetesEvent.findMany.mockResolvedValue([
      { id: "uuid-1", externalSyncId: "hk-1" },
    ] as any)
    await activityService.bulkSync(42, "healthkit", [{
      ...baseSyncItem, externalSyncId: "hk-1", comment: "patient note",
    }], 9, "VIEWER")
    const call = prismaMock.diabetesEvent.createMany.mock.calls[0]![0]!
    const data = (call as any).data as Array<{ comment: string }>
    expect(data[0]!.comment).not.toBe("patient note")
    expect(safeDecryptField(data[0]!.comment)).toBe("patient note")
  })
})

// ─── list — time window + audit ────────────────────────────────────

describe("list — time window + audit", () => {
  beforeEach(() => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 42 } as any)
  })

  it("filters by eventDate range", async () => {
    prismaMock.diabetesEvent.findMany.mockResolvedValue([baseEvent] as any)
    const from = new Date(Date.now() - 30 * 86_400_000)
    const to = new Date()
    await activityService.listByPatient(42, { from, to }, 9, "VIEWER")
    const call = prismaMock.diabetesEvent.findMany.mock.calls[0]![0]!
    expect((call.where as any).eventDate.gte).toEqual(from)
    expect((call.where as any).eventDate.lte).toEqual(to)
  })

  // H2 (review re-1) — orderBy composite déterministe.
  it("H2 — orderBy is composite [eventDate desc, id desc]", async () => {
    prismaMock.diabetesEvent.findMany.mockResolvedValue([] as any)
    await activityService.listByPatient(42, {}, 9, "VIEWER")
    const call = prismaMock.diabetesEvent.findMany.mock.calls[0]![0]!
    expect(call.orderBy).toEqual([{ eventDate: "desc" }, { id: "desc" }])
  })

  // H5 (review re-1) — default limit = 50 (au lieu de 100).
  it("H5 — default limit is 50", async () => {
    prismaMock.diabetesEvent.findMany.mockResolvedValue([] as any)
    await activityService.listByPatient(42, {}, 9, "VIEWER")
    const call = prismaMock.diabetesEvent.findMany.mock.calls[0]![0]!
    expect(call.take).toBe(50)
  })

  // L6 (review re-1) — resourceId = patientId natif US-2268.
  it("L6 — audit resourceId = patientId, metadata.patientId pivot", async () => {
    prismaMock.diabetesEvent.findMany.mockResolvedValue([baseEvent, baseEvent] as any)
    await activityService.listByPatient(42, {
      from: new Date("2026-05-01"),
      to: new Date("2026-05-31"),
    }, 9, "VIEWER")
    const meta = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(meta.resourceId).toBe("42")
    expect(meta.metadata.kind).toBe("activity.list")
    expect(meta.metadata.patientId).toBe(42)
    expect(meta.metadata.count).toBe(2)
    expect(meta.metadata.limit).toBe(50)
    // H5 — bornes auditées pour forensique.
    expect(meta.metadata.from).toBeDefined()
    expect(meta.metadata.to).toBeDefined()
  })
})
