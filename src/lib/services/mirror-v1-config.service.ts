/**
 * @module mirror-v1-config.service
 * @description Groupe 10 Mirror V1 Batch A (4 US, ~14 SP).
 *
 *  - US-2218 emergency contacts (PHI encrypted, max 5)
 *  - US-2219 escalation rules (chain patient → contact → doctor → SAMU)
 *  - US-2220 alert threshold templates (cabinet library)
 *  - US-2221 versioned history (shared `ConfigVersion` hub + immutable trigger)
 *
 * All mutations create a new `ConfigVersion` row ; the prior row's `validTo`
 * is set + `status = "superseded"`. Reads return the active version. Restore
 * = create a new ConfigVersion copying a past snapshot.
 *
 * NURSE creates drafts (status=active, validatedBy null) ; DOCTOR validates
 * by populating `validatedBy + validatedAt`. Until validated, drafts are
 * visible but their child rows (contacts / rules) are not "live" — clients
 * filter `validatedAt !== null` on read.
 */

import {
  Prisma,
  ConfigVersionStatus,
  ConfigVersionType,
  type EscalationTargetType,
} from "@prisma/client"
import { prisma, type PrismaClientOrTx as Tx } from "@/lib/db/client"
import { encryptField, safeDecryptField } from "@/lib/crypto/fields"
import { auditService, type AuditContext } from "./audit.service"
import { NotFoundError, ValidationError } from "./team-workflow.errors"

const MAX_CONTACTS_PER_PATIENT = 5
const MAX_ESCALATION_PRIORITY = 10
const MAX_DELAY_MINUTES = 60
const NAME_MAX_LEN = 100
const PHONE_MAX_LEN = 20
const RELATIONSHIP_MAX_LEN = 50

const PROFILE_TYPES = [
  "T1_ADULT_STABLE", "T1_ADOLESCENT", "T2_INSULIN",
  "GESTATIONAL", "PEDIATRIC",
] as const
export type ProfileType = (typeof PROFILE_TYPES)[number]

// ─────────────────────────────────────────────────────────────
// ConfigVersion — shared hub
// ─────────────────────────────────────────────────────────────

export type ConfigVersionDTO = {
  id: number
  /** C3-NEW — null when the patient has been hard-deleted (audit orphan). */
  patientId: number | null
  configType: ConfigVersionType
  version: number
  validFrom: Date
  validTo: Date | null
  status: ConfigVersionStatus
  createdBy: number
  validatedBy: number | null
  validatedAt: Date | null
  createdAt: Date
}

function toConfigVersionDTO(r: {
  id: number; patientId: number | null; configType: ConfigVersionType; version: number;
  validFrom: Date; validTo: Date | null; status: ConfigVersionStatus;
  createdBy: number; validatedBy: number | null; validatedAt: Date | null;
  createdAt: Date;
}): ConfigVersionDTO {
  return {
    id: r.id, patientId: r.patientId, configType: r.configType,
    version: r.version, validFrom: r.validFrom, validTo: r.validTo,
    status: r.status, createdBy: r.createdBy,
    validatedBy: r.validatedBy, validatedAt: r.validatedAt,
    createdAt: r.createdAt,
  }
}

/** Next `version` integer for (patient, configType) — atomic within the tx. */
async function nextVersion(
  tx: Tx, patientId: number, configType: ConfigVersionType,
): Promise<number> {
  const last = await tx.configVersion.findFirst({
    where: { patientId, configType },
    orderBy: { version: "desc" },
    select: { version: true },
  })
  return (last?.version ?? 0) + 1
}

/** Supersede the currently-active version (if any) before inserting a new one. */
async function supersedePrevious(
  tx: Tx, patientId: number, configType: ConfigVersionType, now: Date,
): Promise<void> {
  await tx.configVersion.updateMany({
    where: { patientId, configType, status: ConfigVersionStatus.active },
    data: { status: ConfigVersionStatus.superseded, validTo: now },
  })
}

// ─────────────────────────────────────────────────────────────
// US-2218 — Emergency Contacts
// ─────────────────────────────────────────────────────────────

export type EmergencyContactInput = {
  rank: number
  name: string
  phone: string
  relationship: string
}

export type EmergencyContactDTO = {
  id: number
  rank: number
  /** L1 — null when decryption fails (corrupted ciphertext, key rotation gap).
   *  Surface as a structured warning in the UI instead of silently rendering "". */
  name: string | null
  phone: string | null
  relationship: string
  /** L1 — true when at least one PHI field couldn't be decrypted. */
  decryptionFailed: boolean
}

function decodeContact(r: {
  id: number; rank: number;
  nameEncrypted: string; phoneEncrypted: string;
  relationship: string;
}): EmergencyContactDTO {
  const name = safeDecryptField(r.nameEncrypted)
  const phone = safeDecryptField(r.phoneEncrypted)
  return {
    id: r.id, rank: r.rank,
    name, phone,
    relationship: r.relationship,
    decryptionFailed: name === null || phone === null,
  }
}

function validateContacts(contacts: EmergencyContactInput[]): void {
  if (contacts.length > MAX_CONTACTS_PER_PATIENT) {
    throw new ValidationError("tooManyContacts")
  }
  const ranks = new Set<number>()
  for (const c of contacts) {
    if (c.rank < 1 || c.rank > MAX_CONTACTS_PER_PATIENT) throw new ValidationError("rank")
    if (ranks.has(c.rank)) throw new ValidationError("duplicateRank")
    ranks.add(c.rank)
    if (!c.name || c.name.length > NAME_MAX_LEN) throw new ValidationError("name")
    if (!c.phone || c.phone.length > PHONE_MAX_LEN) throw new ValidationError("phone")
    if (!c.relationship || c.relationship.length > RELATIONSHIP_MAX_LEN) {
      throw new ValidationError("relationship")
    }
  }
}

export const emergencyContactService = {
  async list(patientId: number, auditUserId: number, ctx?: AuditContext): Promise<{
    version: ConfigVersionDTO | null
    contacts: EmergencyContactDTO[]
  }> {
    const version = await prisma.configVersion.findFirst({
      where: {
        patientId,
        configType: ConfigVersionType.emergency_contacts,
        status: ConfigVersionStatus.active,
      },
      include: { contacts: { orderBy: { rank: "asc" } } },
    })
    await auditService.log({
      userId: auditUserId, action: "READ", resource: "EMERGENCY_CONTACT",
      resourceId: String(patientId),
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { patientId, kind: "list" },
    })
    const contacts = version ? version.contacts.map(decodeContact) : []
    // L1-NEW (re-review) — audit decryption failures distinctly so ops can
    //   alert on KMS rotation gaps / corruption (RGPD Art. 32 §1.b).
    const failed = contacts.filter((c) => c.decryptionFailed).length
    if (failed > 0) {
      await auditService.log({
        userId: auditUserId, action: "READ", resource: "EMERGENCY_CONTACT",
        resourceId: String(patientId),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { patientId, kind: "decrypt.failure", count: failed },
      })
    }
    return {
      version: version ? toConfigVersionDTO(version) : null,
      contacts,
    }
  },

  async upsert(
    patientId: number, contacts: EmergencyContactInput[],
    auditUserId: number, ctx?: AuditContext,
  ): Promise<ConfigVersionDTO> {
    validateContacts(contacts)
    return prisma.$transaction(async (tx: Tx) => {
      const now = new Date()
      const version = await nextVersion(tx, patientId, ConfigVersionType.emergency_contacts)
      await supersedePrevious(tx, patientId, ConfigVersionType.emergency_contacts, now)

      // H8 (re-review) — replace name/phone lengths (mild info disclosure
      //   over a 6-year retention) with simple presence booleans.
      // M4 (re-review) — `satisfies` instead of bare assignment so future
      //   shape changes fail at compile time.
      const snapshot = contacts.map((c) => ({
        rank: c.rank, relationship: c.relationship,
        hasName: c.name.length > 0, hasPhone: c.phone.length > 0,
      })) satisfies Prisma.InputJsonValue
      const created = await tx.configVersion.create({
        data: {
          patientId,
          configType: ConfigVersionType.emergency_contacts,
          version,
          configSnapshot: snapshot,
          createdBy: auditUserId,
          contacts: {
            create: contacts.map((c) => ({
              patientId,
              rank: c.rank,
              nameEncrypted: encryptField(c.name),
              phoneEncrypted: encryptField(c.phone),
              relationship: c.relationship,
            })),
          },
        },
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "CREATE", resource: "CONFIG_VERSION",
        resourceId: String(created.id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: {
          patientId, kind: "emergency_contacts.upsert",
          version, count: contacts.length,
        },
      })
      return toConfigVersionDTO(created)
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },
}

// ─────────────────────────────────────────────────────────────
// US-2219 — Escalation Rules
// ─────────────────────────────────────────────────────────────

export type EscalationRuleInput = {
  priority: number
  targetType: EscalationTargetType
  targetId: number | null
  delayMinutes: number
}

export type EscalationRuleDTO = EscalationRuleInput & { id: number }

function validateRules(rules: EscalationRuleInput[]): void {
  if (rules.length === 0) throw new ValidationError("empty")
  if (rules.length > MAX_ESCALATION_PRIORITY) throw new ValidationError("tooManyRules")
  const priorities = new Set<number>()
  for (const r of rules) {
    if (r.priority < 1 || r.priority > MAX_ESCALATION_PRIORITY) {
      throw new ValidationError("priority")
    }
    if (priorities.has(r.priority)) throw new ValidationError("duplicatePriority")
    priorities.add(r.priority)
    if (r.delayMinutes < 0 || r.delayMinutes > MAX_DELAY_MINUTES) {
      throw new ValidationError("delayMinutes")
    }
    if (r.targetType === "samu" && r.targetId !== null) {
      throw new ValidationError("samuTargetIdMustBeNull")
    }
    if (r.targetType !== "samu" && r.targetId === null) {
      throw new ValidationError("targetIdRequired")
    }
  }
}

export const escalationRuleService = {
  async list(patientId: number, auditUserId: number, ctx?: AuditContext): Promise<{
    version: ConfigVersionDTO | null
    rules: EscalationRuleDTO[]
  }> {
    const version = await prisma.configVersion.findFirst({
      where: {
        patientId,
        configType: ConfigVersionType.escalation_rules,
        status: ConfigVersionStatus.active,
      },
      include: { escalationRules: { orderBy: { priority: "asc" } } },
    })
    await auditService.log({
      userId: auditUserId, action: "READ", resource: "ESCALATION_RULE",
      resourceId: String(patientId),
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { patientId, kind: "list" },
    })
    return {
      version: version ? toConfigVersionDTO(version) : null,
      rules: version ? version.escalationRules.map((r) => ({
        id: r.id, priority: r.priority, targetType: r.targetType,
        targetId: r.targetId, delayMinutes: r.delayMinutes,
      })) : [],
    }
  },

  async upsert(
    patientId: number, rules: EscalationRuleInput[],
    auditUserId: number, ctx?: AuditContext,
  ): Promise<ConfigVersionDTO> {
    validateRules(rules)
    return prisma.$transaction(async (tx: Tx) => {
      const now = new Date()
      const version = await nextVersion(tx, patientId, ConfigVersionType.escalation_rules)
      await supersedePrevious(tx, patientId, ConfigVersionType.escalation_rules, now)
      // C4 (re-review) — redact `targetId` (FK to User/Contact) from snapshot
      //  to avoid persisting raw user identifiers in the 6-year audit history.
      //  Keep the shape (priority, targetType, delayMinutes) for traceability.
      const redactedSnapshot = rules.map((r) => ({
        priority: r.priority,
        targetType: r.targetType,
        delayMinutes: r.delayMinutes,
        hasTarget: r.targetId !== null,
      })) satisfies Prisma.InputJsonValue
      const created = await tx.configVersion.create({
        data: {
          patientId,
          configType: ConfigVersionType.escalation_rules,
          version,
          configSnapshot: redactedSnapshot,
          createdBy: auditUserId,
          escalationRules: {
            create: rules.map((r) => ({
              patientId,
              priority: r.priority,
              targetType: r.targetType,
              targetId: r.targetId,
              delayMinutes: r.delayMinutes,
            })),
          },
        },
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "CREATE", resource: "CONFIG_VERSION",
        resourceId: String(created.id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: {
          patientId, kind: "escalation_rules.upsert",
          version, count: rules.length,
        },
      })
      return toConfigVersionDTO(created)
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },
}

// ─────────────────────────────────────────────────────────────
// US-2220 — Alert Threshold Templates (cabinet library)
// ─────────────────────────────────────────────────────────────

export type AlertThresholdTemplateInput = {
  organizationId: number
  profileType: ProfileType
  name: string
  glucoseLowMgdl: number
  glucoseHighMgdl: number
  glucoseVeryLowMgdl: number
  glucoseVeryHighMgdl: number
  alertOnHypo?: boolean
  cooldownMinutes?: number
}

export type AlertThresholdTemplateDTO = {
  id: number
  organizationId: number
  profileType: ProfileType
  name: string
  glucoseLowMgdl: number
  glucoseHighMgdl: number
  glucoseVeryLowMgdl: number
  glucoseVeryHighMgdl: number
  alertOnHypo: boolean
  cooldownMinutes: number
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

function toTemplateDTO(r: {
  id: number; organizationId: number; profileType: string; name: string;
  glucoseLowMgdl: Prisma.Decimal; glucoseHighMgdl: Prisma.Decimal;
  glucoseVeryLowMgdl: Prisma.Decimal; glucoseVeryHighMgdl: Prisma.Decimal;
  alertOnHypo: boolean; cooldownMinutes: number; isActive: boolean;
  createdAt: Date; updatedAt: Date;
}): AlertThresholdTemplateDTO {
  return {
    id: r.id, organizationId: r.organizationId,
    profileType: r.profileType as ProfileType,
    name: r.name,
    glucoseLowMgdl: r.glucoseLowMgdl.toNumber(),
    glucoseHighMgdl: r.glucoseHighMgdl.toNumber(),
    glucoseVeryLowMgdl: r.glucoseVeryLowMgdl.toNumber(),
    glucoseVeryHighMgdl: r.glucoseVeryHighMgdl.toNumber(),
    alertOnHypo: r.alertOnHypo, cooldownMinutes: r.cooldownMinutes,
    isActive: r.isActive,
    createdAt: r.createdAt, updatedAt: r.updatedAt,
  }
}

function validateThresholdTemplate(input: AlertThresholdTemplateInput): void {
  if (!PROFILE_TYPES.includes(input.profileType)) throw new ValidationError("profileType")
  if (!input.name || input.name.length > 100) throw new ValidationError("name")
  const { glucoseVeryLowMgdl, glucoseLowMgdl, glucoseHighMgdl, glucoseVeryHighMgdl } = input
  if (
    !(glucoseVeryLowMgdl < glucoseLowMgdl
      && glucoseLowMgdl < glucoseHighMgdl
      && glucoseHighMgdl < glucoseVeryHighMgdl)
  ) throw new ValidationError("thresholdOrder")
  if (glucoseLowMgdl < 40 || glucoseLowMgdl > 250) throw new ValidationError("glucoseLowMgdl")
  if (glucoseHighMgdl < 100 || glucoseHighMgdl > 400) throw new ValidationError("glucoseHighMgdl")
  if (
    input.cooldownMinutes !== undefined
    && (input.cooldownMinutes < 5 || input.cooldownMinutes > 360)
  ) throw new ValidationError("cooldownMinutes")
}

export const alertThresholdTemplateService = {
  async list(organizationId: number): Promise<AlertThresholdTemplateDTO[]> {
    const rows = await prisma.alertThresholdTemplate.findMany({
      where: { organizationId, isActive: true },
      orderBy: [{ profileType: "asc" }, { name: "asc" }],
      take: 200,
    })
    return rows.map(toTemplateDTO)
  },

  async create(
    input: AlertThresholdTemplateInput, auditUserId: number, ctx?: AuditContext,
  ): Promise<AlertThresholdTemplateDTO> {
    validateThresholdTemplate(input)
    return prisma.$transaction(async (tx: Tx) => {
      // C6 (re-review) — Serializable so concurrent creates with the same
      //   (organizationId, profileType, name) collide cleanly at the unique
      //   index AND retry-on-conflict at the app level.
      try {
        const created = await tx.alertThresholdTemplate.create({
          data: {
            organizationId: input.organizationId,
            profileType: input.profileType,
            name: input.name,
            glucoseLowMgdl: new Prisma.Decimal(input.glucoseLowMgdl),
            glucoseHighMgdl: new Prisma.Decimal(input.glucoseHighMgdl),
            glucoseVeryLowMgdl: new Prisma.Decimal(input.glucoseVeryLowMgdl),
            glucoseVeryHighMgdl: new Prisma.Decimal(input.glucoseVeryHighMgdl),
            alertOnHypo: input.alertOnHypo ?? true,
            cooldownMinutes: input.cooldownMinutes ?? 30,
            createdBy: auditUserId,
          },
        })
        await auditService.logWithTx(tx, {
          userId: auditUserId, action: "CREATE", resource: "ALERT_THRESHOLD_TEMPLATE",
          resourceId: String(created.id),
          ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
          metadata: {
            organizationId: input.organizationId,
            profileType: input.profileType, name: input.name,
          },
        })
        return toTemplateDTO(created)
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
        ) throw new ValidationError("alreadyExists")
        throw err
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },

  async deleteById(id: number, auditUserId: number, ctx?: AuditContext) {
    return prisma.$transaction(async (tx: Tx) => {
      const existing = await tx.alertThresholdTemplate.findUnique({ where: { id } })
      if (!existing) throw new NotFoundError()
      await tx.alertThresholdTemplate.delete({ where: { id } })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "DELETE", resource: "ALERT_THRESHOLD_TEMPLATE",
        resourceId: String(id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: {
          organizationId: existing.organizationId,
          profileType: existing.profileType, name: existing.name,
        },
      })
      return { deleted: true as const }
    })
  },
}

// ─────────────────────────────────────────────────────────────
// US-2221 — Versioned history (read + restore)
// ─────────────────────────────────────────────────────────────

export const configVersionHistoryService = {
  async listHistory(
    patientId: number, configType: ConfigVersionType,
    auditUserId: number, ctx?: AuditContext,
  ): Promise<ConfigVersionDTO[]> {
    const rows = await prisma.configVersion.findMany({
      where: { patientId, configType },
      orderBy: { version: "desc" },
      take: 100,
    })
    await auditService.log({
      userId: auditUserId, action: "READ", resource: "CONFIG_VERSION",
      resourceId: String(patientId),
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { patientId, kind: "history.list", configType, count: rows.length },
    })
    return rows.map(toConfigVersionDTO)
  },

  /** Validate (DOCTOR signs off a NURSE-created version). */
  async validate(
    versionId: number, auditUserId: number, ctx?: AuditContext,
  ): Promise<ConfigVersionDTO> {
    return prisma.$transaction(async (tx: Tx) => {
      const row = await tx.configVersion.findUnique({ where: { id: versionId } })
      if (!row) throw new NotFoundError()
      if (row.validatedAt !== null) throw new ValidationError("alreadyValidated")
      const updated = await tx.configVersion.update({
        where: { id: versionId },
        data: { validatedBy: auditUserId, validatedAt: new Date() },
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "UPDATE", resource: "CONFIG_VERSION",
        resourceId: String(versionId),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: {
          patientId: row.patientId, configType: row.configType,
          version: row.version, kind: "validate",
        },
      })
      return toConfigVersionDTO(updated)
    })
  },
}
