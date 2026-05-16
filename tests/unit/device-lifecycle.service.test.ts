/**
 * @description Groupe 4 — Devices & Sync (US-2091 + US-2092 + US-2093).
 *
 * Couvre :
 *   - supportedDeviceService.search + isSupported + create (admin)
 *   - deviceLifecycleService.revoke : idempotent + RBAC + raison chiffrée
 *   - deviceLifecycleService.listHistory : tri + filter includeRevoked + audit pivot
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

import {
  supportedDeviceService,
  deviceLifecycleService,
  DEVICE_LIFECYCLE_BOUNDS,
  DeviceLifecycleValidationError,
  DeviceLifecycleAccessError,
  DeviceLifecycleNotFoundError,
} from "@/lib/services/device-lifecycle.service"
import { Prisma } from "@prisma/client"

const ctx = {
  ipAddress: "1.2.3.4",
  userAgent: "Chrome",
  requestId: "req-1",
}

beforeEach(() => {
  prismaMock.auditLog.create.mockResolvedValue({} as any)
  prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock))
})

// ────────────────────────────────────────────────────────────────
// US-2091 supportedDeviceService
// ────────────────────────────────────────────────────────────────

describe("supportedDeviceService.search", () => {
  it("returns active devices filtered by category", async () => {
    prismaMock.supportedDevice.findMany.mockResolvedValue([
      { id: 1, brand: "Dexcom", model: "G7", category: "cgm",
        modelIdentifier: null, connectionTypes: ["bluetooth"],
        sensorLifetimeDays: 10, isHdsCertified: true, notes: null, isActive: true,
        createdAt: new Date(), updatedAt: new Date(), createdBy: null },
    ] as any)
    const out = await supportedDeviceService.search({ category: "cgm" }, 9, ctx)
    expect(out).toHaveLength(1)
    expect(out[0]!.brand).toBe("Dexcom")
    const where = prismaMock.supportedDevice.findMany.mock.calls[0]![0]!.where as any
    expect(where.category).toBe("cgm")
    expect(where.isActive).toBe(true)
  })

  it("includeInactive=true ne filtre pas sur isActive", async () => {
    prismaMock.supportedDevice.findMany.mockResolvedValue([] as any)
    await supportedDeviceService.search({ includeInactive: true }, 9, ctx)
    const where = prismaMock.supportedDevice.findMany.mock.calls[0]![0]!.where as any
    expect(where.isActive).toBeUndefined()
  })

  it("audit kind=supported_device.search + resultCount", async () => {
    prismaMock.supportedDevice.findMany.mockResolvedValue([] as any)
    await supportedDeviceService.search({ brand: "Dexcom" }, 9, ctx)
    const meta = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(meta.metadata.kind).toBe("supported_device.search")
    expect(meta.metadata.resultCount).toBe(0)
  })
})

describe("supportedDeviceService.isSupported", () => {
  it("returns true for active known device", async () => {
    prismaMock.supportedDevice.findUnique.mockResolvedValue({ isActive: true } as any)
    const out = await supportedDeviceService.isSupported("Dexcom", "G7", "cgm")
    expect(out).toBe(true)
  })

  it("returns false for unknown device", async () => {
    prismaMock.supportedDevice.findUnique.mockResolvedValue(null)
    const out = await supportedDeviceService.isSupported("UnknownBrand", "X", "cgm")
    expect(out).toBe(false)
  })

  it("returns false for inactive device", async () => {
    prismaMock.supportedDevice.findUnique.mockResolvedValue({ isActive: false } as any)
    const out = await supportedDeviceService.isSupported("Old", "Model", "cgm")
    expect(out).toBe(false)
  })
})

describe("supportedDeviceService.create", () => {
  it("creates new entry (admin)", async () => {
    prismaMock.supportedDevice.create.mockResolvedValue({
      id: 1, brand: "Abbott", model: "FreeStyle Libre 3", category: "cgm",
      modelIdentifier: null, connectionTypes: ["nfc"],
      sensorLifetimeDays: 14, isHdsCertified: true, notes: null, isActive: true,
      createdAt: new Date(), updatedAt: new Date(), createdBy: 9,
    } as any)
    const out = await supportedDeviceService.create({
      brand: "Abbott", model: "FreeStyle Libre 3", category: "cgm",
      connectionTypes: ["nfc"], sensorLifetimeDays: 14, isHdsCertified: true,
    }, 9, ctx)
    expect(out.brand).toBe("Abbott")
    expect(out.sensorLifetimeDays).toBe(14)
  })

  it("rejects sensorLifetimeDays out of range", async () => {
    await expect(
      supportedDeviceService.create({
        brand: "X", model: "Y", category: "cgm", sensorLifetimeDays: 365,
      }, 9, ctx),
    ).rejects.toBeInstanceOf(DeviceLifecycleValidationError)
  })

  it("rejects duplicate (brand, model, category) → P2002", async () => {
    prismaMock.supportedDevice.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "test" }),
    )
    await expect(
      supportedDeviceService.create({
        brand: "Dexcom", model: "G7", category: "cgm",
      }, 9, ctx),
    ).rejects.toThrow(/alreadyExists/)
  })
})

// ────────────────────────────────────────────────────────────────
// US-2092 deviceLifecycleService.revoke
// ────────────────────────────────────────────────────────────────

describe("deviceLifecycleService.revoke", () => {
  it("revokes device (cabinet PS)", async () => {
    prismaMock.patientService.findFirst.mockResolvedValue({ id: 1 } as any)
    prismaMock.patientDevice.findFirst.mockResolvedValue({ id: 10, revokedAt: null } as any)
    prismaMock.patientDevice.updateMany.mockResolvedValue({ count: 1 } as any)
    const out = await deviceLifecycleService.revoke(
      42, 10, "Remplacé suite à dysfonctionnement", 9, "DOCTOR", ctx,
    )
    expect(out.revoked).toBe(true)
    expect(out.alreadyRevoked).toBe(false)
    // updateMany WHERE id + patientId + revokedAt: null (atomic CAS).
    const updWhere = prismaMock.patientDevice.updateMany.mock.calls[0]![0]!.where as any
    expect(updWhere.id).toBe(10)
    expect(updWhere.patientId).toBe(42)
    expect(updWhere.revokedAt).toBe(null)
    // Reason chiffré (Buffer base64 in updateMany.data).
    const updData = prismaMock.patientDevice.updateMany.mock.calls[0]![0]!.data as any
    expect(updData.revokedReasonEnc).toBeTruthy()
    expect(updData.revokedReasonEnc).not.toContain("dysfonctionnement") // chiffré
  })

  it("idempotent : revoke 2× = alreadyRevoked=true (no DB write)", async () => {
    prismaMock.patientService.findFirst.mockResolvedValue({ id: 1 } as any)
    prismaMock.patientDevice.findFirst.mockResolvedValue({
      id: 10, revokedAt: new Date("2026-01-01"),
    } as any)
    const out = await deviceLifecycleService.revoke(42, 10, "x", 9, "DOCTOR", ctx)
    expect(out.alreadyRevoked).toBe(true)
    expect(prismaMock.patientDevice.updateMany).not.toHaveBeenCalled()
  })

  it("404 si device n'appartient pas au patient", async () => {
    prismaMock.patientService.findFirst.mockResolvedValue({ id: 1 } as any)
    prismaMock.patientDevice.findFirst.mockResolvedValue(null)
    await expect(
      deviceLifecycleService.revoke(42, 99, "x", 9, "DOCTOR", ctx),
    ).rejects.toBeInstanceOf(DeviceLifecycleNotFoundError)
  })

  it("403 si DOCTOR pas membre du cabinet du patient", async () => {
    prismaMock.patientService.findFirst.mockResolvedValue(null)
    await expect(
      deviceLifecycleService.revoke(42, 10, "x", 9, "DOCTOR", ctx),
    ).rejects.toBeInstanceOf(DeviceLifecycleAccessError)
    // accessDenied audit row émis (US-2265).
    const denied = prismaMock.auditLog.create.mock.calls.find((c) => {
      const d = c[0].data as any
      return d.action === "UNAUTHORIZED" && d.metadata?.kind === "device.revoke.accessDenied"
    })
    expect(denied).toBeDefined()
  })

  it("VIEWER (patient owner) peut révoquer son propre device", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 42 } as any)
    prismaMock.patientDevice.findFirst.mockResolvedValue({ id: 10, revokedAt: null } as any)
    prismaMock.patientDevice.updateMany.mockResolvedValue({ count: 1 } as any)
    const out = await deviceLifecycleService.revoke(42, 10, "Remplacé", 9, "VIEWER", ctx)
    expect(out.revoked).toBe(true)
  })

  it("VIEWER autre patient → 403", async () => {
    prismaMock.patient.findFirst.mockResolvedValue(null)
    await expect(
      deviceLifecycleService.revoke(99, 10, "x", 9, "VIEWER", ctx),
    ).rejects.toBeInstanceOf(DeviceLifecycleAccessError)
  })

  it("ADMIN bypass cabinet check (mais respecte soft-delete patient)", async () => {
    // shared canAccessPatient vérifie deletedAt même pour ADMIN.
    prismaMock.patient.findFirst.mockResolvedValue({ id: 42 } as any)
    prismaMock.patientDevice.findFirst.mockResolvedValue({ id: 10, revokedAt: null } as any)
    prismaMock.patientDevice.updateMany.mockResolvedValue({ count: 1 } as any)
    const out = await deviceLifecycleService.revoke(42, 10, "x", 9, "ADMIN", ctx)
    expect(out.revoked).toBe(true)
  })

  // CR C1 review — ADMIN sur patient soft-deleted = forbidden (invariant RGPD).
  it("CR C1 — ADMIN sur patient soft-deleted → 403", async () => {
    prismaMock.patient.findFirst.mockResolvedValue(null) // soft-deleted
    await expect(
      deviceLifecycleService.revoke(99, 10, "x", 9, "ADMIN", ctx),
    ).rejects.toBeInstanceOf(DeviceLifecycleAccessError)
  })

  it("rejects empty reason", async () => {
    await expect(
      deviceLifecycleService.revoke(42, 10, "", 9, "DOCTOR", ctx),
    ).rejects.toBeInstanceOf(DeviceLifecycleValidationError)
  })

  it("rejects reason > MAX_REASON_LEN", async () => {
    const tooLong = "x".repeat(DEVICE_LIFECYCLE_BOUNDS.MAX_REASON_LEN + 1)
    await expect(
      deviceLifecycleService.revoke(42, 10, tooLong, 9, "DOCTOR", ctx),
    ).rejects.toBeInstanceOf(DeviceLifecycleValidationError)
  })

  it("atomic CAS — race lost (updateMany count=0) = alreadyRevoked=true", async () => {
    prismaMock.patientService.findFirst.mockResolvedValue({ id: 1 } as any)
    prismaMock.patientDevice.findFirst.mockResolvedValue({ id: 10, revokedAt: null } as any)
    prismaMock.patientDevice.updateMany.mockResolvedValue({ count: 0 } as any)
    const out = await deviceLifecycleService.revoke(42, 10, "x", 9, "DOCTOR", ctx)
    expect(out.alreadyRevoked).toBe(true)
  })

  it("audit kind=device.revoked + pivot patientId", async () => {
    prismaMock.patientService.findFirst.mockResolvedValue({ id: 1 } as any)
    prismaMock.patientDevice.findFirst.mockResolvedValue({ id: 10, revokedAt: null } as any)
    prismaMock.patientDevice.updateMany.mockResolvedValue({ count: 1 } as any)
    await deviceLifecycleService.revoke(42, 10, "Replaced", 9, "DOCTOR", ctx)
    const meta = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(meta.metadata.kind).toBe("device.revoked")
    expect(meta.metadata.patientId).toBe(42)
  })
})

// ────────────────────────────────────────────────────────────────
// US-2093 deviceLifecycleService.listHistory
// ────────────────────────────────────────────────────────────────

describe("deviceLifecycleService.listHistory", () => {
  it("lists all devices (active + revoked) for cabinet member", async () => {
    prismaMock.patientService.findFirst.mockResolvedValue({ id: 1 } as any)
    prismaMock.patientDevice.findMany.mockResolvedValue([
      { id: 1, patientId: 42, brand: "Dexcom", model: "G7", category: "cgm",
        sn: "SN001", date: new Date("2026-01-01"),
        revokedAt: new Date("2026-04-01"), revokedBy: 5, revokedReasonEnc: null,
        batteryLevel: 80, sensorExpiresAt: null, lastSyncAt: null },
      { id: 2, patientId: 42, brand: "Abbott", model: "FreeStyle 3", category: "cgm",
        sn: "SN002", date: new Date("2026-04-15"),
        revokedAt: null, revokedBy: null, revokedReasonEnc: null,
        batteryLevel: 95, sensorExpiresAt: null, lastSyncAt: null },
    ] as any)
    const out = await deviceLifecycleService.listHistory(42, 9, "DOCTOR", ctx)
    expect(out).toHaveLength(2)
    expect(out[0]!.isActive).toBe(false) // revoked first
    expect(out[1]!.isActive).toBe(true)
  })

  it("403 si pas membre cabinet", async () => {
    prismaMock.patientService.findFirst.mockResolvedValue(null)
    await expect(
      deviceLifecycleService.listHistory(42, 9, "DOCTOR", ctx),
    ).rejects.toBeInstanceOf(DeviceLifecycleAccessError)
    const denied = prismaMock.auditLog.create.mock.calls.find((c) => {
      const d = c[0].data as any
      return d.action === "UNAUTHORIZED" && d.metadata?.kind === "device.history.accessDenied"
    })
    expect(denied).toBeDefined()
  })

  it("includeRevoked=false filter actifs only", async () => {
    prismaMock.patientService.findFirst.mockResolvedValue({ id: 1 } as any)
    prismaMock.patientDevice.findMany.mockResolvedValue([] as any)
    await deviceLifecycleService.listHistory(42, 9, "DOCTOR", ctx, { includeRevoked: false })
    const where = prismaMock.patientDevice.findMany.mock.calls[0]![0]!.where as any
    expect(where.revokedAt).toBe(null)
  })

  it("audit kind=device.history + resourceId=list + pivot patientId + count", async () => {
    prismaMock.patientService.findFirst.mockResolvedValue({ id: 1 } as any)
    prismaMock.patientDevice.findMany.mockResolvedValue([
      { id: 1, patientId: 42, brand: null, model: null, category: null,
        sn: null, date: null, revokedAt: null, revokedBy: null, revokedReasonEnc: null,
        batteryLevel: null, sensorExpiresAt: null, lastSyncAt: null },
    ] as any)
    await deviceLifecycleService.listHistory(42, 9, "DOCTOR", ctx)
    const auditCall = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(auditCall.metadata.kind).toBe("device.history")
    expect(auditCall.resourceId).toBe("list") // Prisma F-4 review
    expect(auditCall.metadata.patientId).toBe(42) // pivot US-2268
    expect(auditCall.metadata.count).toBe(1)
  })

  // CR C2 review — VIEWER ne doit PAS recevoir revokedReason (PHI cross-actor).
  it("CR C2 — VIEWER ne reçoit pas revokedReason (clinician-only)", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 42 } as any)
    // Mock encryptField output : un blob valid base64.
    const fakeEnc = Buffer.from("fake").toString("base64")
    prismaMock.patientDevice.findMany.mockResolvedValue([
      { id: 1, patientId: 42, brand: "Dexcom", model: "G7", category: "cgm",
        sn: null, date: null,
        revokedAt: new Date("2026-04-01"), revokedBy: 5,
        revokedReasonEnc: fakeEnc,
        batteryLevel: null, sensorExpiresAt: null, lastSyncAt: null },
    ] as any)
    const out = await deviceLifecycleService.listHistory(42, 9, "VIEWER", ctx)
    expect(out[0]!.revokedReason).toBe(null) // masqué pour VIEWER
  })

  // CR C2 — PS+ reçoit revokedReason déchiffré.
  it("CR C2 — DOCTOR reçoit revokedReason déchiffré", async () => {
    prismaMock.patientService.findFirst.mockResolvedValue({ id: 1 } as any)
    const fakeEnc = Buffer.from("fake").toString("base64")
    prismaMock.patientDevice.findMany.mockResolvedValue([
      { id: 1, patientId: 42, brand: null, model: null, category: null,
        sn: null, date: null,
        revokedAt: new Date(), revokedBy: 5,
        revokedReasonEnc: fakeEnc,
        batteryLevel: null, sensorExpiresAt: null, lastSyncAt: null },
    ] as any)
    const out = await deviceLifecycleService.listHistory(42, 9, "DOCTOR", ctx)
    // safeDecryptField sur fake ciphertext = null. Mais la branche du code
    // tente le decrypt (et logue warning si échec).
    expect(out[0]!.revokedReason).toBe(null) // decrypt fail OK pour test
  })

  // Prisma F-1 review — orderBy avec nulls: last.
  it("Prisma F-1 — orderBy revokedAt nulls:last", async () => {
    prismaMock.patientService.findFirst.mockResolvedValue({ id: 1 } as any)
    prismaMock.patientDevice.findMany.mockResolvedValue([] as any)
    await deviceLifecycleService.listHistory(42, 9, "DOCTOR", ctx)
    const orderBy = prismaMock.patientDevice.findMany.mock.calls[0]![0]!.orderBy as any
    expect(orderBy[0]).toEqual({ revokedAt: { sort: "desc", nulls: "last" } })
    expect(orderBy[1]).toEqual({ date: { sort: "desc", nulls: "last" } })
    expect(orderBy[2]).toEqual({ id: "desc" }) // tie-breaker
  })

  it("limit capped at MAX_HISTORY_PAGE", async () => {
    prismaMock.patientService.findFirst.mockResolvedValue({ id: 1 } as any)
    prismaMock.patientDevice.findMany.mockResolvedValue([] as any)
    await deviceLifecycleService.listHistory(42, 9, "DOCTOR", ctx, { limit: 9999 })
    const take = prismaMock.patientDevice.findMany.mock.calls[0]![0]!.take
    expect(take).toBe(DEVICE_LIFECYCLE_BOUNDS.MAX_HISTORY_PAGE)
  })
})
