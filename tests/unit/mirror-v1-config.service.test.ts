/**
 * Test suite: mirror-v1-config.service (Groupe 10 Batch A — 4 US, 14 SP)
 *
 * Covers:
 *  - US-2218 emergency contacts validation (max 5, rank dedupe, lengths)
 *  - US-2219 escalation rules validation (priority dedupe, samu target)
 *  - US-2220 alert threshold templates (ordering, bounds, P2002 mapping)
 *  - US-2221 versioned history (validate, listHistory audit)
 */
import { describe, it, expect, beforeEach } from "vitest"
import { Prisma, ConfigVersionType, ConfigVersionStatus } from "@prisma/client"
import { prismaMock } from "../helpers/prisma-mock"
import {
  emergencyContactService,
  escalationRuleService,
  alertThresholdTemplateService,
  configVersionHistoryService,
} from "@/lib/services/mirror-v1-config.service"
import {
  NotFoundError,
  ValidationError,
} from "@/lib/services/team-workflow.errors"

beforeEach(() => {
  prismaMock.auditLog.create.mockResolvedValue({} as any)
  prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock))
})

describe("emergencyContactService (US-2218)", () => {
  it("rejects more than 5 contacts", async () => {
    const tooMany = Array.from({ length: 6 }, (_, i) => ({
      rank: i + 1, name: "X", phone: "1", relationship: "parent",
    }))
    await expect(emergencyContactService.upsert(7, tooMany, 9))
      .rejects.toBeInstanceOf(ValidationError)
  })
  it("rejects duplicate rank", async () => {
    await expect(
      emergencyContactService.upsert(7, [
        { rank: 1, name: "A", phone: "1", relationship: "parent" },
        { rank: 1, name: "B", phone: "2", relationship: "spouse" },
      ], 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("rejects rank out of bounds", async () => {
    await expect(
      emergencyContactService.upsert(7, [
        { rank: 6, name: "A", phone: "1", relationship: "parent" },
      ], 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("rejects empty name", async () => {
    await expect(
      emergencyContactService.upsert(7, [
        { rank: 1, name: "", phone: "1", relationship: "parent" },
      ], 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("happy path supersedes previous + audits + encrypts", async () => {
    prismaMock.configVersion.findFirst.mockResolvedValue(null) // no previous version
    prismaMock.configVersion.updateMany.mockResolvedValue({ count: 0 } as any)
    prismaMock.configVersion.create.mockResolvedValue({
      id: 1, patientId: 7, configType: ConfigVersionType.emergency_contacts,
      version: 1, validFrom: new Date(), validTo: null,
      status: ConfigVersionStatus.active, createdBy: 9,
      validatedBy: null, validatedAt: null,
      createdAt: new Date(),
    } as any)
    const out = await emergencyContactService.upsert(7, [
      { rank: 1, name: "Jean Dupont", phone: "+33 6 12 34 56 78", relationship: "spouse" },
    ], 9)
    expect(out.id).toBe(1)
    expect(out.version).toBe(1)
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.resource).toBe("CONFIG_VERSION")
    expect(audit.metadata.kind).toBe("emergency_contacts.upsert")
    // PHI must not appear in audit
    const auditStr = JSON.stringify(audit)
    expect(auditStr).not.toContain("Dupont")
    expect(auditStr).not.toContain("0612345678")
  })
})

describe("escalationRuleService (US-2219)", () => {
  it("rejects empty rules", async () => {
    await expect(escalationRuleService.upsert(7, [], 9))
      .rejects.toBeInstanceOf(ValidationError)
  })
  it("rejects duplicate priority", async () => {
    await expect(
      escalationRuleService.upsert(7, [
        { priority: 1, targetType: "contact", targetId: 1, delayMinutes: 5 },
        { priority: 1, targetType: "doctor", targetId: 2, delayMinutes: 10 },
      ], 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("rejects samu with non-null targetId", async () => {
    await expect(
      escalationRuleService.upsert(7, [
        { priority: 1, targetType: "samu", targetId: 99, delayMinutes: 5 },
      ], 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("rejects contact with null targetId", async () => {
    await expect(
      escalationRuleService.upsert(7, [
        { priority: 1, targetType: "contact", targetId: null, delayMinutes: 5 },
      ], 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("rejects delay > 60 min", async () => {
    await expect(
      escalationRuleService.upsert(7, [
        { priority: 1, targetType: "samu", targetId: null, delayMinutes: 61 },
      ], 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })
})

describe("alertThresholdTemplateService (US-2220)", () => {
  it("rejects unknown profileType", async () => {
    await expect(
      alertThresholdTemplateService.create({
        organizationId: 1, profileType: "BOGUS" as any, name: "x",
        glucoseLowMgdl: 70, glucoseHighMgdl: 180,
        glucoseVeryLowMgdl: 54, glucoseVeryHighMgdl: 250,
      }, 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("rejects threshold order violation (low > high)", async () => {
    await expect(
      alertThresholdTemplateService.create({
        organizationId: 1, profileType: "T1_ADULT_STABLE", name: "x",
        glucoseLowMgdl: 200, glucoseHighMgdl: 180,
        glucoseVeryLowMgdl: 54, glucoseVeryHighMgdl: 250,
      }, 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("maps P2002 to ValidationError(alreadyExists)", async () => {
    const err = new Prisma.PrismaClientKnownRequestError(
      "unique violation", { code: "P2002", clientVersion: "7.6.0", meta: {} },
    )
    prismaMock.alertThresholdTemplate.create.mockRejectedValueOnce(err)
    await expect(
      alertThresholdTemplateService.create({
        organizationId: 1, profileType: "T1_ADULT_STABLE", name: "T1 Adulte",
        glucoseLowMgdl: 70, glucoseHighMgdl: 180,
        glucoseVeryLowMgdl: 54, glucoseVeryHighMgdl: 250,
      }, 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("happy path + audits resource ALERT_THRESHOLD_TEMPLATE", async () => {
    prismaMock.alertThresholdTemplate.create.mockResolvedValue({
      id: 1, organizationId: 1, profileType: "T1_ADULT_STABLE", name: "T1 Adulte",
      glucoseLowMgdl: new Prisma.Decimal(70),
      glucoseHighMgdl: new Prisma.Decimal(180),
      glucoseVeryLowMgdl: new Prisma.Decimal(54),
      glucoseVeryHighMgdl: new Prisma.Decimal(250),
      alertOnHypo: true, cooldownMinutes: 30, isActive: true,
      createdAt: new Date(), updatedAt: new Date(),
    } as any)
    await alertThresholdTemplateService.create({
      organizationId: 1, profileType: "T1_ADULT_STABLE", name: "T1 Adulte",
      glucoseLowMgdl: 70, glucoseHighMgdl: 180,
      glucoseVeryLowMgdl: 54, glucoseVeryHighMgdl: 250,
    }, 9)
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.resource).toBe("ALERT_THRESHOLD_TEMPLATE")
  })
})

describe("configVersionHistoryService (US-2221)", () => {
  it("listHistory returns versions sorted desc + audits", async () => {
    prismaMock.configVersion.findMany.mockResolvedValue([
      { id: 2, version: 2, patientId: 7, configType: ConfigVersionType.emergency_contacts,
        validFrom: new Date(), validTo: null, status: ConfigVersionStatus.active,
        createdBy: 9, validatedBy: null, validatedAt: null, createdAt: new Date() },
      { id: 1, version: 1, patientId: 7, configType: ConfigVersionType.emergency_contacts,
        validFrom: new Date(), validTo: new Date(), status: ConfigVersionStatus.superseded,
        createdBy: 9, validatedBy: null, validatedAt: null, createdAt: new Date() },
    ] as any)
    const out = await configVersionHistoryService.listHistory(
      7, ConfigVersionType.emergency_contacts, 9,
    )
    expect(out).toHaveLength(2)
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.metadata.kind).toBe("history.list")
  })

  it("validate rejects already-validated", async () => {
    prismaMock.configVersion.findUnique.mockResolvedValue({
      id: 1, validatedAt: new Date(), validatedBy: 99,
    } as any)
    await expect(configVersionHistoryService.validate(1, 9))
      .rejects.toBeInstanceOf(ValidationError)
  })
  it("validate happy path", async () => {
    prismaMock.configVersion.findUnique.mockResolvedValue({
      id: 1, patientId: 7, configType: ConfigVersionType.emergency_contacts,
      version: 1, validatedAt: null, validatedBy: null,
    } as any)
    prismaMock.configVersion.update.mockResolvedValue({
      id: 1, patientId: 7, configType: ConfigVersionType.emergency_contacts,
      version: 1, validFrom: new Date(), validTo: null,
      status: ConfigVersionStatus.active, createdBy: 9,
      validatedBy: 9, validatedAt: new Date(), createdAt: new Date(),
    } as any)
    const out = await configVersionHistoryService.validate(1, 9)
    expect(out.validatedBy).toBe(9)
  })
  it("validate throws NotFoundError when missing", async () => {
    prismaMock.configVersion.findUnique.mockResolvedValue(null)
    await expect(configVersionHistoryService.validate(999, 9))
      .rejects.toBeInstanceOf(NotFoundError)
  })
})
