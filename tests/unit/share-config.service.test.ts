/**
 * Test suite : share-config.service (Groupe 10 Batch D US-2240 + US-2242).
 *
 * Couvre :
 *  - US-2240 third_party_share : upsert validation bounds (date passée,
 *    expiration > 365j), snapshot Zod parse on read, snapshotInvalid flag
 *  - US-2242 shared_notifications : upsert + parse + audit kind
 *  - Réutilisation patientModeWorkflow.validate via SUPPORTED_MODE_TYPES
 *    élargi (vérifié dans patient-modes test)
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  ConfigVersionStatus, ConfigVersionType, Prisma,
} from "@prisma/client"
import { prismaMock } from "../helpers/prisma-mock"
import {
  thirdPartyShareService, sharedNotificationsService,
  ShareValidationError,
} from "@/lib/services/share-config.service"

beforeEach(() => {
  prismaMock.auditLog.create.mockResolvedValue({} as any)
  prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock))
})

// ─── US-2240 third_party_share ───────────────────────────────────────

describe("thirdPartyShareService (US-2240)", () => {
  const validInput = {
    recipient: "École Maternelle",
    recipientType: "school" as const,
    purpose: "Suivi glycémie classe",
    expiresAt: new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10),
  }

  it("upsert rejects expiration in past", async () => {
    const past = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    await expect(thirdPartyShareService.upsert(7, {
      ...validInput, expiresAt: past,
    }, 9)).rejects.toBeInstanceOf(ShareValidationError)
  })

  it("upsert rejects expiration > 365 days", async () => {
    const tooFar = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10)
    await expect(thirdPartyShareService.upsert(7, {
      ...validInput, expiresAt: tooFar,
    }, 9)).rejects.toBeInstanceOf(ShareValidationError)
  })

  // M1 (re-review) — boundary : today (Paris end-of-day) must be accepted.
  //
  // Fix 2026-05-17 (flaky timezone) : le test utilisait `new Date().toISOString()`
  // qui retourne la date UTC. Entre 22h UTC et minuit UTC (= 00h-02h Paris du
  // lendemain), "today UTC" = jour J, mais end-of-day Paris = J 21:59 UTC →
  // déjà passé → throw `expiresPast`. Fix : fake timer à midi UTC neutre.
  it("upsert accepts expiresAt = today (Paris end-of-day)", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"))
    try {
      prismaMock.configVersion.findFirst.mockResolvedValue({ version: 0 } as any)
      prismaMock.configVersion.updateMany.mockResolvedValue({ count: 0 } as any)
      prismaMock.configVersion.create.mockResolvedValue({
        id: 100, patientId: 7, configType: ConfigVersionType.third_party_share,
        version: 1, validFrom: new Date(), validTo: null,
        status: ConfigVersionStatus.active, createdBy: 9,
        validatedBy: null, validatedAt: null, createdAt: new Date(),
      } as any)
      // Avec systemTime = 2026-06-15T12:00:00Z (= 14:00 Paris CEST),
      // today UTC = "2026-06-15" et end-of-day Paris = 21:59:59 UTC > now.
      const today = new Date().toISOString().slice(0, 10)
      const out = await thirdPartyShareService.upsert(7, {
        ...validInput, expiresAt: today,
      }, 9)
      expect(out.id).toBe(100)
    } finally {
      vi.useRealTimers()
    }
  })

  it("upsert happy path emits audit + creates ConfigVersion", async () => {
    prismaMock.configVersion.findFirst.mockResolvedValue({ version: 0 } as any)
    prismaMock.configVersion.updateMany.mockResolvedValue({ count: 0 } as any)
    prismaMock.configVersion.create.mockResolvedValue({
      id: 100, patientId: 7, configType: ConfigVersionType.third_party_share,
      version: 1, validFrom: new Date(), validTo: null,
      status: ConfigVersionStatus.active, createdBy: 9,
      validatedBy: null, validatedAt: null, createdAt: new Date(),
    } as any)
    const out = await thirdPartyShareService.upsert(7, validInput, 9)
    expect(out.id).toBe(100)
    const meta = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(meta.metadata.kind).toBe("third_party_share.upsert")
    expect(meta.metadata.recipientType).toBe("school")
  })

  it("getActive returns snapshotInvalid when JSONB is corrupted", async () => {
    prismaMock.configVersion.findFirst.mockResolvedValue({
      id: 100, patientId: 7, configType: ConfigVersionType.third_party_share,
      version: 1, validFrom: new Date(), validTo: null,
      status: ConfigVersionStatus.active, createdBy: 9,
      validatedBy: null, validatedAt: null, createdAt: new Date(),
      configSnapshot: { recipient: 123 } as Prisma.JsonValue, // wrong type
    } as any)
    const out = await thirdPartyShareService.getActive(7, 9)
    expect(out.snapshotInvalid).toBe(true)
    expect(out.config).toBeNull()
  })

  it("getActive parses valid snapshot", async () => {
    prismaMock.configVersion.findFirst.mockResolvedValue({
      id: 100, patientId: 7, configType: ConfigVersionType.third_party_share,
      version: 1, validFrom: new Date(), validTo: null,
      status: ConfigVersionStatus.active, createdBy: 9,
      validatedBy: null, validatedAt: null, createdAt: new Date(),
      configSnapshot: validInput,
    } as any)
    const out = await thirdPartyShareService.getActive(7, 9)
    expect(out.snapshotInvalid).toBe(false)
    expect(out.config!.recipient).toBe("École Maternelle")
  })
})

// ─── US-2242 shared_notifications ────────────────────────────────────

describe("sharedNotificationsService (US-2242)", () => {
  const validInput = {
    routing: {
      severe_hypo: [1, 2, 3],
      hypo: [1, 2],
      ketone_dka: [1, 2, 3, 4],
    },
  }

  it("upsert creates new version with routing snapshot (caregivers exist)", async () => {
    prismaMock.user.findMany.mockResolvedValue([
      { id: 1 }, { id: 2 }, { id: 3 }, { id: 4 },
    ] as any)
    prismaMock.configVersion.findFirst.mockResolvedValue({ version: 0 } as any)
    prismaMock.configVersion.updateMany.mockResolvedValue({ count: 0 } as any)
    prismaMock.configVersion.create.mockResolvedValue({
      id: 200, patientId: 7, configType: ConfigVersionType.shared_notifications,
      version: 1, validFrom: new Date(), validTo: null,
      status: ConfigVersionStatus.active, createdBy: 9,
      validatedBy: null, validatedAt: null, createdAt: new Date(),
    } as any)
    const out = await sharedNotificationsService.upsert(7, validInput, 9)
    expect(out.id).toBe(200)
    const meta = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(meta.metadata.kind).toBe("shared_notifications.upsert")
    expect(meta.metadata.alertTypesConfigured).toBe(3)
    expect(meta.metadata.caregiverCount).toBe(4) // distinct: 1,2,3,4
  })

  // M5 (re-review) — caregiverId FK check rejects unknown/inactive users.
  it("upsert rejects when a caregiverId is not a known active User", async () => {
    prismaMock.user.findMany.mockResolvedValue([
      { id: 1 }, { id: 2 }, // id=3, id=4 missing/inactive
    ] as any)
    await expect(sharedNotificationsService.upsert(7, validInput, 9))
      .rejects.toThrow(/unknownCaregiverIds:3,4|unknownCaregiverIds:4,3/)
  })

  it("getActive returns null config when no active version", async () => {
    prismaMock.configVersion.findFirst.mockResolvedValue(null)
    const out = await sharedNotificationsService.getActive(7, 9)
    expect(out.version).toBeNull()
    expect(out.config).toBeNull()
    expect(out.snapshotInvalid).toBe(false)
  })

  it("getActive flags snapshotInvalid + audits failure separately", async () => {
    prismaMock.configVersion.findFirst.mockResolvedValue({
      id: 200, patientId: 7, configType: ConfigVersionType.shared_notifications,
      version: 1, validFrom: new Date(), validTo: null,
      status: ConfigVersionStatus.active, createdBy: 9,
      validatedBy: null, validatedAt: null, createdAt: new Date(),
      configSnapshot: { routing: "wrong-type" },
    } as any)
    const out = await sharedNotificationsService.getActive(7, 9)
    expect(out.snapshotInvalid).toBe(true)
    expect(out.config).toBeNull()
    const lastAudit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(lastAudit.metadata.kind).toBe("shared_notifications.snapshot.invalid")
  })
})
